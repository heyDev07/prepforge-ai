import {
  addFlashcard,
  addQuestion,
  assertUrlAllowed,
  computeFingerprint,
  computeWeakSpots,
  deleteFlashcard,
  deleteQuestion,
  isFetchFailure,
  orderPracticeQueue,
  parseHttpUrl,
  rebuildSchedule,
  reorderQuestions,
  setDaysAvailable,
  toExternalKit,
  updateCompanyBrief,
  updateFlashcard,
  updateQuestion,
  computeCardStats,
} from '@prepforge/pipeline';
import {
  AppError,
  CreateFlashcardBodySchema,
  CreateKitBodySchema,
  CreateQuestionBodySchema,
  PracticeBodySchema,
  PracticeNextQuerySchema,
  QuestionCategorySchema,
  RegenerateCompanyBodySchema,
  ReorderQuestionsBodySchema,
  UpdateFlashcardBodySchema,
  UpdateKitBodySchema,
  UpdateQuestionBodySchema,
  type InternalKit,
  type PracticeNextDto,
} from '@prepforge/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/sessions';
import type { ApiConfig } from '../config';
import { parseBody, parseQuery } from '../middleware/validate';
import { GenerationJobModel, Kit, PracticeAttempt, type KitDoc } from '../models';
import type { JobRunner } from '../services/job-runner';
import {
  assertNoActiveJob,
  findLatestJob,
  findOwnedKit,
  jobToDto,
  loadAttempts,
  requireGenerated,
  saveKit,
  toDetail,
  toSummary,
  weakRequirementIds,
} from '../services/kits';

const RevisionSchema = z.object({ revision: z.number().int().nonnegative().optional() });

export function kitsRouter(config: ApiConfig, jobs: JobRunner): Router {
  const router = Router();
  router.use(requireAuth);
  const maxCoveragePasses = config.pipeline.pipeline.maxCoveragePasses;

  const load = (req: Request) => findOwnedKit(currentUser(req).id, String(req.params.id));

  const detail = async (doc: KitDoc) => toDetail(doc, await findLatestJob(doc._id));

  /**
   * Applies a pure edit to a generated kit and saves it with a revision check.
   * Weak requirements from practice are passed so schedule rebuilds can prioritise them.
   */
  async function mutate<T>(
    req: Request,
    edit: (kit: InternalKit, weak: ReadonlySet<string>) => { kit: InternalKit; result?: T },
  ) {
    const doc = await load(req);
    await assertNoActiveJob(doc._id);
    const kit = requireGenerated(doc);
    const { revision } = RevisionSchema.parse({ revision: req.body?.revision });
    const { kit: next, result } = edit(kit, await weakRequirementIds(doc));
    const saved = await saveKit(
      doc,
      { kit: next },
      { maxCoveragePasses, expectedRevision: revision },
    );
    return { kit: await detail(saved), result };
  }

  // ---- kits ---------------------------------------------------------------------------

  router.get('/', async (req, res) => {
    const docs = await Kit.find({ userId: currentUser(req).id })
      .sort({ createdAt: -1 })
      .lean<KitDoc[]>();
    const jobs = await Promise.all(docs.map((doc) => findLatestJob(doc._id)));
    res.json({ kits: docs.map((doc, i) => toSummary(doc, jobs[i] ?? null)) });
  });

  router.post('/', async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(CreateKitBodySchema, req);
    try {
      await assertUrlAllowed(parseHttpUrl(body.company_url), {
        allowPrivateNetwork: config.pipeline.crawler.allowPrivateUrls,
      });
    } catch (error) {
      // unresolvable hosts are reported by the generation job; only policy violations are rejected here
      if (!isFetchFailure(error) || error.status === 'blocked_url') {
        throw new AppError(
          'URL_NOT_ALLOWED',
          isFetchFailure(error) ? error.message : 'Invalid URL.',
          {
            status: 400,
          },
        );
      }
    }
    const fingerprint = computeFingerprint(body.jd, body.company_url);
    if (!body.allow_duplicate) {
      const existing = await Kit.findOne({ userId: user.id, fingerprint }).select('_id').lean();
      if (existing) {
        throw new AppError(
          'DUPLICATE_KIT',
          'You already have a kit for this job description and company.',
          {
            status: 409,
            details: { existing_kit_id: String(existing._id) },
          },
        );
      }
    }
    const doc = await Kit.create({
      userId: user.id,
      fingerprint,
      input: { jd: body.jd, company_url: body.company_url, days: body.days },
    });
    res.status(201).json({ kit: toDetail(doc.toObject() as KitDoc, null) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ kit: await detail(await load(req)) });
  });

  router.patch('/:id', async (req, res) => {
    const body = parseBody(UpdateKitBodySchema, req);
    const { kit } = await mutate(req, (current, weak) => {
      let next = current;
      if (body.company_brief) next = updateCompanyBrief(next, body.company_brief);
      if (body.days_available !== undefined) {
        next = setDaysAvailable(next, body.days_available, { weakRequirementIds: weak });
      }
      return { kit: next };
    });
    res.json({ kit });
  });

  router.delete('/:id', async (req, res) => {
    const doc = await load(req);
    await assertNoActiveJob(doc._id);
    await Promise.all([
      Kit.deleteOne({ _id: doc._id, userId: doc.userId }),
      GenerationJobModel.deleteMany({ kitId: doc._id }),
      PracticeAttempt.deleteMany({ kitId: doc._id }),
    ]);
    res.status(204).end();
  });

  router.get('/:id/export', async (req, res) => {
    const doc = await load(req);
    const kit = toExternalKit(requireGenerated(doc));
    res.setHeader(
      'content-disposition',
      `attachment; filename="prepforge-kit-${String(doc._id)}.json"`,
    );
    res.json(kit);
  });

  // ---- generation ---------------------------------------------------------------------

  router.post('/:id/generate', async (req, res) => {
    const doc = await load(req);
    if (doc.kit && doc.status !== 'failed') {
      throw new AppError(
        'CONFLICT',
        'This kit is already generated. Regenerate individual sections to keep your edits.',
        { status: 409 },
      );
    }
    const job = await jobs.create(doc, 'generate');
    res.status(202).json({ job: jobToDto(job) });
  });

  router.get('/:id/generation-status', async (req, res) => {
    const doc = await load(req);
    const job = await findLatestJob(doc._id);
    res.json({ kit_status: doc.status, job: job ? jobToDto(job) : null });
  });

  router.post('/:id/regenerate/company', async (req, res) => {
    const body = parseBody(RegenerateCompanyBodySchema, req);
    const doc = await load(req);
    const kit = requireGenerated(doc);
    // refuse early so the user gets immediate feedback instead of a failed job
    if (kit.company_brief.state === 'pinned') {
      throw new AppError('CONFLICT', 'The company brief is pinned. Unpin it before regenerating.', {
        status: 409,
      });
    }
    if (kit.company_brief.state === 'edited' && !body.force) {
      throw new AppError(
        'CONFIRMATION_REQUIRED',
        'The company brief has been edited. Confirm that you want to replace your changes.',
        { status: 409 },
      );
    }
    const job = await jobs.create(doc, 'regenerate_company', {
      params: { force: Boolean(body.force) },
    });
    res.status(202).json({ job: jobToDto(job) });
  });

  router.post('/:id/regenerate/questions/:category', async (req, res) => {
    const category = QuestionCategorySchema.parse(req.params.category);
    const doc = await load(req);
    requireGenerated(doc);
    const job = await jobs.create(doc, 'regenerate_questions', { category });
    res.status(202).json({ job: jobToDto(job) });
  });

  router.post('/:id/regenerate/schedule', async (req, res) => {
    const { kit } = await mutate(req, (current, weak) => ({
      kit: rebuildSchedule(current, { weakRequirementIds: weak }),
    }));
    res.json({ kit });
  });

  // ---- questions ----------------------------------------------------------------------

  router.post('/:id/questions', async (req, res) => {
    const body = parseBody(CreateQuestionBodySchema, req);
    const { kit, result } = await mutate(req, (current, weak) => {
      const added = addQuestion(current, body, { weakRequirementIds: weak });
      return { kit: added.kit, result: added.question };
    });
    res.status(201).json({ question: result, kit });
  });

  router.post('/:id/questions/reorder', async (req, res) => {
    const body = parseBody(ReorderQuestionsBodySchema, req);
    const { kit } = await mutate(req, (current, weak) => ({
      kit: reorderQuestions(current, body.category, body.ordered_ids, { weakRequirementIds: weak }),
    }));
    res.json({ kit });
  });

  router.patch('/:id/questions/:questionId', async (req, res) => {
    const { revision: _revision, ...patch } = parseBody(UpdateQuestionBodySchema, req);
    const { kit, result } = await mutate(req, (current, weak) => {
      const updated = updateQuestion(current, String(req.params.questionId), patch, {
        weakRequirementIds: weak,
      });
      return { kit: updated.kit, result: updated.question };
    });
    res.json({ question: result, kit });
  });

  router.delete('/:id/questions/:questionId', async (req, res) => {
    const { kit } = await mutate(req, (current, weak) => ({
      kit: deleteQuestion(current, String(req.params.questionId), { weakRequirementIds: weak }),
    }));
    res.json({ kit });
  });

  // ---- flashcards ---------------------------------------------------------------------

  router.post('/:id/flashcards', async (req, res) => {
    const body = parseBody(CreateFlashcardBodySchema, req);
    const { kit, result } = await mutate(req, (current) => {
      const added = addFlashcard(current, body);
      return { kit: added.kit, result: added.flashcard };
    });
    res.status(201).json({ flashcard: result, kit });
  });

  router.patch('/:id/flashcards/:flashcardId', async (req, res) => {
    const { revision: _revision, ...patch } = parseBody(UpdateFlashcardBodySchema, req);
    const { kit, result } = await mutate(req, (current) => {
      const updated = updateFlashcard(current, String(req.params.flashcardId), patch);
      return { kit: updated.kit, result: updated.flashcard };
    });
    res.json({ flashcard: result, kit });
  });

  router.delete('/:id/flashcards/:flashcardId', async (req, res) => {
    const { kit } = await mutate(req, (current) => ({
      kit: deleteFlashcard(current, String(req.params.flashcardId)),
    }));
    res.json({ kit });
  });

  // ---- practice and weak spots --------------------------------------------------------

  router.post('/:id/practice/:flashcardId', async (req, res) => {
    const body = parseBody(PracticeBodySchema, req);
    const doc = await load(req);
    const kit = requireGenerated(doc);
    const flashcardId = String(req.params.flashcardId);
    if (!kit.flashcards.some((card) => card.id === flashcardId)) {
      throw new AppError('NOT_FOUND', 'Flashcard not found.', { status: 404 });
    }
    await PracticeAttempt.create({
      userId: doc.userId,
      kitId: doc._id,
      flashcardId,
      confidence: body.confidence,
    });
    const stats = computeCardStats(kit.flashcards, await loadAttempts(doc._id, doc.userId));
    res.status(201).json({ stats: stats.get(flashcardId) });
  });

  router.get('/:id/practice/next', async (req, res) => {
    const query = parseQuery(PracticeNextQuerySchema, req);
    const doc = await load(req);
    const kit = requireGenerated(doc);
    const queue = orderPracticeQueue(kit, await loadAttempts(doc._id, doc.userId), {
      mode: query.mode,
      answered: query.answered,
      lastId: query.last,
      currentId: query.current,
    });
    const next = queue[0];
    const body: PracticeNextDto = {
      flashcard: next?.flashcard ?? null,
      stats: next?.stats ?? null,
      remaining: queue.length,
      mode: query.mode,
    };
    res.json(body);
  });

  router.get('/:id/weak-spots', async (req, res) => {
    const doc = await load(req);
    const kit = requireGenerated(doc);
    res.json({ weak_spots: computeWeakSpots(kit, await loadAttempts(doc._id, doc.userId)) });
  });

  return router;
}
