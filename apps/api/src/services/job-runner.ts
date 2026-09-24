/**
 * In-process generation queue (no Redis needed at this scale). Jobs are stored in MongoDB, so
 * progress survives page reloads and a crashed job is visible as failed after a restart.
 *
 *   POST /generate → job "queued" → runner picks it up → "running" with per-stage updates
 *   → "completed" (kit saved) or "failed" (structured error; kit untouched on regeneration)
 */
import {
  regenerateCategory,
  regenerateCompanyBrief,
  runPipeline,
  type PipelineDeps,
  type StageEvent,
} from '@prepforge/pipeline';
import {
  AppError,
  PIPELINE_STAGE_SEQUENCE,
  toStructuredError,
  type GenerationStage,
  type InternalKit,
  type JobType,
  type QuestionCategory,
  type ResearchBundle,
  type StageLogEntry,
} from '@prepforge/shared';
import type { Types } from 'mongoose';
import type { ApiConfig } from '../config';
import { GenerationJobModel, Kit, type JobDoc, type KitDoc } from '../models';
import { findActiveJob, jobToDto, saveKit, weakRequirementIds } from './kits';

export type PipelineServices = Omit<PipelineDeps, 'config' | 'signal'>;

/** Stages shown for regeneration jobs (a subset of the full pipeline). */
const JOB_STAGES: Record<Exclude<JobType, 'generate'>, GenerationStage[]> = {
  regenerate_company: ['generating_company_brief', 'validating', 'persisting', 'completed'],
  regenerate_questions: [
    'generating_questions',
    'checking_coverage',
    'building_schedule',
    'validating',
    'persisting',
    'completed',
  ],
};

/** Records stage progress on the job document; writes are serialised so they never reorder. */
class JobProgress {
  private log: StageLogEntry[] = [];
  private lastStep = -1;
  private writes: Promise<unknown> = Promise.resolve();
  stage: GenerationStage | null = null;

  constructor(
    private readonly jobId: Types.ObjectId,
    private readonly sequence: readonly GenerationStage[],
  ) {}

  private persist(progress: number) {
    const update = { currentStage: this.stage, progress, stageLog: [...this.log] };
    this.writes = this.writes.then(() =>
      GenerationJobModel.updateOne({ _id: this.jobId }, { $set: update }),
    );
  }

  /** Applies a pipeline stage event. */
  event(event: Pick<StageEvent, 'stage' | 'status' | 'detail' | 'step'> & { progress: number }) {
    const now = new Date().toISOString();
    const isNewStep = event.step !== this.lastStep;
    this.stage = event.stage;
    if (event.status === 'skipped') {
      this.log.push({
        stage: event.stage,
        status: 'skipped',
        started_at: now,
        ended_at: now,
        detail: event.detail,
      });
    } else if (isNewStep) {
      this.log.push({
        stage: event.stage,
        status: event.status === 'completed' ? 'completed' : 'running',
        started_at: now,
        ended_at: event.status === 'completed' ? now : null,
        detail: event.detail,
      });
    } else {
      const entry = this.log.at(-1)!;
      entry.status = event.status === 'completed' ? 'completed' : 'running';
      if (event.detail !== null) entry.detail = event.detail;
      if (event.status === 'completed') entry.ended_at = now;
    }
    this.lastStep = event.step;
    this.persist(event.progress);
  }

  /** Marks a stage of a regeneration job as running, completing the previous one. */
  start(stage: GenerationStage, detail: string | null = null) {
    const step = this.sequence.indexOf(stage, this.lastStep + 1);
    const progress = Math.round((step / (this.sequence.length - 1)) * 100);
    this.completeCurrent();
    this.event({ stage, status: 'running', detail, step, progress });
  }

  complete(detail: string | null = null) {
    const step = this.lastStep;
    this.event({
      stage: this.stage!,
      status: 'completed',
      detail,
      step,
      progress: Math.round((step / (this.sequence.length - 1)) * 100),
    });
  }

  private completeCurrent() {
    const entry = this.log.at(-1);
    if (entry && entry.status === 'running') {
      entry.status = 'completed';
      entry.ended_at = new Date().toISOString();
    }
  }

  failCurrent(message: string) {
    const entry = this.log.at(-1);
    if (entry && entry.status === 'running') {
      entry.status = 'failed';
      entry.ended_at = new Date().toISOString();
      entry.detail = message;
    }
    this.persist(0);
  }

  get entries(): StageLogEntry[] {
    return [...this.log];
  }

  flush() {
    return this.writes;
  }
}

export class JobRunner {
  private readonly queue: string[] = [];
  private running = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly config: ApiConfig,
    private readonly services: PipelineServices,
  ) {}

  /** Creates and enqueues a job; refuses when one is already queued or running for the kit. */
  async create(
    kit: KitDoc,
    type: JobType,
    options: { category?: QuestionCategory; params?: Record<string, unknown> } = {},
  ): Promise<JobDoc> {
    const active = await findActiveJob(kit._id);
    if (active) {
      throw new AppError('JOB_IN_PROGRESS', 'A generation job is already running for this kit.', {
        status: 409,
        details: { job: jobToDto(active) },
      });
    }
    const job = await GenerationJobModel.create({
      kitId: kit._id,
      userId: kit.userId,
      type,
      category: options.category ?? null,
      options: options.params ?? {},
    });
    await Kit.updateOne(
      { _id: kit._id },
      { $set: { lastJobId: job._id, ...(type === 'generate' ? { status: 'generating' } : {}) } },
    );
    this.enqueue(String(job._id));
    return job.toObject() as JobDoc;
  }

  enqueue(jobId: string) {
    this.queue.push(jobId);
    this.pump();
  }

  /** Resolves when no job is queued or running (used by tests and graceful shutdown). */
  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** After a restart: fail jobs that were mid-run, re-queue jobs that never started. */
  async recover(): Promise<void> {
    const interrupted = await GenerationJobModel.find({ status: 'running' }).lean<JobDoc[]>();
    for (const job of interrupted) {
      await GenerationJobModel.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Generation was interrupted by a server restart. Please retry.',
              stage: job.currentStage,
              retryable: true,
            },
          },
        },
      );
      if (job.type === 'generate') {
        await Kit.updateOne(
          { _id: job.kitId, status: 'generating' },
          { $set: { status: 'failed' } },
        );
      }
    }
    const queued = await GenerationJobModel.find({ status: 'queued' })
      .sort({ createdAt: 1 })
      .lean<JobDoc[]>();
    for (const job of queued) this.enqueue(String(job._id));
  }

  private pump() {
    while (this.running < this.config.generationConcurrency && this.queue.length > 0) {
      const jobId = this.queue.shift()!;
      this.running++;
      void this.execute(jobId).finally(() => {
        this.running--;
        this.pump();
        if (this.running === 0 && this.queue.length === 0) {
          for (const resolve of this.idleWaiters.splice(0)) resolve();
        }
      });
    }
  }

  private async execute(jobId: string) {
    const job = await GenerationJobModel.findById(jobId).lean<JobDoc>();
    if (!job || job.status !== 'queued') return;
    const kit = await Kit.findById(job.kitId).lean<KitDoc>();
    const sequence = job.type === 'generate' ? PIPELINE_STAGE_SEQUENCE : JOB_STAGES[job.type];
    const progress = new JobProgress(job._id, sequence);
    await GenerationJobModel.updateOne(
      { _id: job._id },
      { $set: { status: 'running', startedAt: new Date() } },
    );

    const signal = AbortSignal.timeout(this.config.pipeline.pipeline.caseTimeoutMs);
    const deps: PipelineDeps = { ...this.services, config: this.config.pipeline, signal };
    const maxCoveragePasses = this.config.pipeline.pipeline.maxCoveragePasses;

    try {
      if (!kit) throw new AppError('NOT_FOUND', 'Kit not found.', { status: 404 });

      if (job.type === 'generate') {
        const result = await runPipeline(kit.input, deps, (event) => progress.event(event));
        progress.event({
          stage: 'persisting',
          status: 'running',
          detail: null,
          step: 11,
          progress: 92,
        });
        await saveKit(
          kit,
          {
            kit: result.kit,
            research: result.research,
            status: result.status,
            notes: result.notes,
          },
          { maxCoveragePasses },
        );
      } else {
        const current = kit.kit as InternalKit | null;
        const research = kit.research as ResearchBundle | null;
        if (!current || !research) {
          throw new AppError('CONFLICT', 'Generate the kit before regenerating a section.', {
            status: 409,
          });
        }
        let next: InternalKit;
        if (job.type === 'regenerate_company') {
          progress.start('generating_company_brief');
          next = await regenerateCompanyBrief(current, research, deps, {
            jd: kit.input.jd,
            force: Boolean((job.options as { force?: boolean } | null)?.force),
          });
        } else {
          progress.start('generating_questions', `Regenerating ${job.category} questions`);
          const result = await regenerateCategory(
            current,
            job.category as QuestionCategory,
            research,
            deps,
            { weakRequirementIds: await weakRequirementIds(kit) },
          );
          progress.start('checking_coverage');
          progress.start(
            'building_schedule',
            `${result.addedIds.length} new, ${result.removedIds.length} replaced`,
          );
          next = result.kit;
        }
        progress.start('validating');
        progress.start('persisting');
        await saveKit(kit, { kit: next }, { maxCoveragePasses });
      }

      progress.start('completed');
      progress.complete();
      await progress.flush();
      await GenerationJobModel.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'completed',
            progress: 100,
            completedAt: new Date(),
            stageLog: progress.entries,
          },
        },
      );
    } catch (error) {
      const stage = progress.stage ?? 'validating';
      const structured = signal.aborted
        ? {
            code: 'PIPELINE_TIMEOUT' as const,
            message: 'Generation took too long and was stopped.',
            stage,
            retryable: true,
          }
        : toStructuredError(error, stage);
      if (structured.code === 'INTERNAL_ERROR') console.error('[jobs] unexpected failure', error);
      progress.failCurrent(structured.message);
      await progress.flush();
      await GenerationJobModel.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'failed',
            error: structured,
            completedAt: new Date(),
            stageLog: progress.entries,
          },
        },
      );
      if (job.type === 'generate') {
        await Kit.updateOne(
          { _id: job.kitId },
          { $set: { status: 'failed' }, $inc: { revision: 1 } },
        );
      }
    }
  }
}
