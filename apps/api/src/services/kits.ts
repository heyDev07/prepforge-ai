/**
 * Kit persistence rules:
 *   - every lookup is scoped to the signed-in user; another user's kit is "not found" (404)
 *   - nothing is written unless the kit passes validateKit
 *   - writes use optimistic concurrency on `revision` (409 CONFLICT on a stale write)
 *   - while a generation job runs for a kit, edits are refused (409 JOB_IN_PROGRESS)
 */
import { toExternalKit, validateKit, computeWeakSpots, type KitIssue } from '@prepforge/pipeline';
import {
  AppError,
  InternalKitSchema,
  type GenerationJob,
  type InternalKit,
  type KitDetailDto,
  type KitStatus,
  type KitSummaryDto,
  type PracticeAttemptRecord,
  type ResearchBundle,
} from '@prepforge/shared';
import type { Types } from 'mongoose';
import { isValidObjectId } from 'mongoose';
import { GenerationJobModel, Kit, PracticeAttempt, type JobDoc, type KitDoc } from '../models';

const notFound = () => new AppError('NOT_FOUND', 'Kit not found.', { status: 404 });

export async function findOwnedKit(userId: Types.ObjectId, kitId: string): Promise<KitDoc> {
  if (!isValidObjectId(kitId)) throw notFound();
  const doc = await Kit.findOne({ _id: kitId, userId }).lean<KitDoc>();
  if (!doc) throw notFound();
  return doc;
}

export async function findActiveJob(kitId: Types.ObjectId): Promise<JobDoc | null> {
  return GenerationJobModel.findOne({ kitId, status: { $in: ['queued', 'running'] } })
    .sort({ createdAt: -1 })
    .lean<JobDoc>();
}

export async function findLatestJob(kitId: Types.ObjectId): Promise<JobDoc | null> {
  return GenerationJobModel.findOne({ kitId }).sort({ createdAt: -1 }).lean<JobDoc>();
}

export async function assertNoActiveJob(kitId: Types.ObjectId): Promise<void> {
  const active = await findActiveJob(kitId);
  if (active) {
    throw new AppError(
      'JOB_IN_PROGRESS',
      'The kit is being generated. Try again when it finishes.',
      {
        status: 409,
        details: { job: jobToDto(active) },
      },
    );
  }
}

export function requireGenerated(doc: KitDoc): InternalKit {
  if (!doc.kit) {
    throw new AppError('CONFLICT', 'This kit has not been generated yet.', { status: 409 });
  }
  return doc.kit as InternalKit;
}

export function statusFor(kit: InternalKit): KitStatus {
  return kit.coverage.uncovered_requirement_ids.length > 0 ? 'ready_with_gaps' : 'ready';
}

/** Validates the kit and returns its warnings; throws instead of letting an invalid kit be saved. */
export function checkKit(kit: InternalKit, maxCoveragePasses: number): KitIssue[] {
  InternalKitSchema.parse(kit);
  const result = validateKit(toExternalKit(kit), { maxCoveragePasses });
  if (!result.valid) {
    throw new AppError('KIT_VALIDATION_FAILED', 'The change would make the kit invalid.', {
      status: 422,
      details: { fields: result.errors.slice(0, 10) },
    });
  }
  return result.warnings;
}

export interface KitChanges {
  kit?: InternalKit;
  research?: ResearchBundle | null;
  status?: KitStatus;
  notes?: string[];
  lastJobId?: Types.ObjectId;
}

/** Writes changes if the stored revision still equals `expectedRevision`. */
export async function saveKit(
  doc: KitDoc,
  changes: KitChanges,
  options: { maxCoveragePasses: number; expectedRevision?: number },
): Promise<KitDoc> {
  const expected = options.expectedRevision ?? doc.revision;
  const set: Record<string, unknown> = {};
  if (changes.kit) {
    const warnings = checkKit(changes.kit, options.maxCoveragePasses);
    set.kit = changes.kit;
    set.warnings = warnings.map((w) => ({ code: w.code, message: w.message }));
    set.status = changes.status ?? statusFor(changes.kit);
  } else if (changes.status) {
    set.status = changes.status;
  }
  if (changes.research !== undefined) set.research = changes.research;
  if (changes.notes) set.notes = changes.notes;
  if (changes.lastJobId) set.lastJobId = changes.lastJobId;

  const updated = await Kit.findOneAndUpdate(
    { _id: doc._id, userId: doc.userId, revision: expected },
    { $set: set, $inc: { revision: 1 } },
    { new: true },
  ).lean<KitDoc>();
  if (!updated) {
    throw new AppError('CONFLICT', 'The kit was changed elsewhere. Reload and try again.', {
      status: 409,
    });
  }
  return updated;
}

export async function loadAttempts(
  kitId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<PracticeAttemptRecord[]> {
  const attempts = await PracticeAttempt.find({ kitId, userId }).sort({ createdAt: 1 }).lean();
  return attempts.map((a) => ({
    flashcard_id: a.flashcardId,
    confidence: a.confidence,
    created_at: a.createdAt.toISOString(),
  }));
}

/** Requirements the user is weak on, used to prioritise the schedule. */
export async function weakRequirementIds(doc: KitDoc): Promise<Set<string>> {
  if (!doc.kit) return new Set();
  const attempts = await loadAttempts(doc._id, doc.userId);
  if (attempts.length === 0) return new Set();
  return new Set(computeWeakSpots(doc.kit as InternalKit, attempts).weak_requirement_ids);
}

// ---------------------------------------------------------------------------------------
// DTOs

export function jobToDto(job: JobDoc): GenerationJob {
  return {
    id: String(job._id),
    kit_id: String(job.kitId),
    type: job.type,
    category: (job.category ?? null) as GenerationJob['category'],
    status: job.status,
    current_stage: (job.currentStage ?? null) as GenerationJob['current_stage'],
    progress: job.progress,
    stage_log: (job.stageLog ?? []) as GenerationJob['stage_log'],
    error: (job.error ?? null) as GenerationJob['error'],
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt ? job.startedAt.toISOString() : null,
    completed_at: job.completedAt ? job.completedAt.toISOString() : null,
  };
}

function companyLabel(doc: KitDoc): string {
  const kit = doc.kit as InternalKit | null;
  if (kit) return kit.source.company;
  try {
    return new URL(doc.input.company_url).hostname.replace(/^www\./, '');
  } catch {
    return doc.input.company_url;
  }
}

export function toSummary(doc: KitDoc, job: JobDoc | null): KitSummaryDto {
  const kit = doc.kit as InternalKit | null;
  return {
    id: String(doc._id),
    company: companyLabel(doc),
    role: kit?.role.title ?? null,
    company_url: doc.input.company_url,
    status: doc.status,
    days: kit?.schedule.days_available ?? doc.input.days,
    questions: kit?.questions.length ?? 0,
    flashcards: kit?.flashcards.length ?? 0,
    created_at: doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
    latest_job: job
      ? {
          id: String(job._id),
          type: job.type,
          status: job.status,
          current_stage: (job.currentStage ?? null) as GenerationJob['current_stage'],
          progress: job.progress,
        }
      : null,
  };
}

export function toDetail(doc: KitDoc, job: JobDoc | null): KitDetailDto {
  return {
    id: String(doc._id),
    status: doc.status,
    input: { jd: doc.input.jd, company_url: doc.input.company_url, days: doc.input.days },
    kit: (doc.kit as InternalKit | null) ?? null,
    research: (doc.research as ResearchBundle | null) ?? null,
    notes: doc.notes ?? [],
    warnings: (doc.warnings ?? []).map((w) => ({ code: w.code ?? '', message: w.message ?? '' })),
    revision: doc.revision,
    latest_job: job ? jobToDto(job) : null,
    created_at: doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
  };
}
