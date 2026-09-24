/**
 * runPipeline — the single generation pipeline shared by the web app (job runner) and the
 * batch evaluator. Stages run in the documented order; each is either deterministic code or a
 * small, focused LLM call. Persistence is the caller's job: the pipeline returns a kit that
 * has already passed validateKit, and never an invalid one.
 *
 *   validating → extracting_requirements → researching_company → researching_interviews
 *   → generating_company_brief → generating_questions → checking_coverage
 *   → generating_missing_questions → generating_flashcards → building_schedule → validating
 *   (→ persisting → completed, reported by the caller)
 */
import {
  AppError,
  isAppError,
  PIPELINE_STAGE_SEQUENCE,
  PipelineInputSchema,
  type GenerationStage,
  type InternalKit,
  type PublicResearch,
  type ResearchBundle,
} from '@prepforge/shared';
import { createCachedLoader, type CacheStore } from './cache';
import type { PipelineConfig } from './config';
import { runCoverageLoop } from './coverage/coverage-loop';
import { refreshDerived } from './editing/derive';
import { appendFlashcards, appendQuestions } from './editing/merge';
import { toExternalKit } from './editing/project';
import { extractRequirements, type ExtractionResult } from './extraction/extract-requirements';
import { extractionCacheKey, researchCacheKey } from './fingerprint';
import { generateCompanyBrief } from './generation/company-brief';
import type { GenerationContext } from './generation/context';
import { generateFlashcards, generateFlashcardsForRequirements } from './generation/flashcards';
import {
  generateCategoryQuestions,
  generateQuestionsForRequirements,
  planFor,
} from './generation/questions';
import type { LlmProvider } from './llm/provider';
import { isFetchFailure } from './net/errors';
import type { HttpClient } from './net/http-client';
import { assertUrlAllowed, parseHttpUrl, type LookupFn, type UrlPolicy } from './net/url-guard';
import { deriveCompanyName } from './research/company-name';
import { crawlCompanySite, type CrawlResult } from './research/crawler';
import { selectResearchSources } from './research/excerpts';
import { researchInterviews } from './search/interview-research';
import type { SearchProvider } from './search/provider';
import { validateKit, type KitIssue } from './validation/validate-kit';

export interface PipelineDeps {
  config: PipelineConfig;
  llm: LlmProvider;
  http: HttpClient;
  search: SearchProvider | null;
  /** SSRF policy. The web app forbids private networks; the evaluator allows local servers. */
  policy: UrlPolicy;
  cache?: CacheStore;
  lookup?: LookupFn;
  now?: () => Date;
  signal?: AbortSignal;
}

export type StageStatus = 'running' | 'completed' | 'skipped';

export interface StageEvent {
  stage: GenerationStage;
  /** Position in PIPELINE_STAGE_SEQUENCE ("validating" appears twice). */
  step: number;
  status: StageStatus;
  detail: string | null;
  /** 0–100 */
  progress: number;
}

export type PipelineReporter = (event: StageEvent) => void;

export interface PipelineResult {
  kit: InternalKit;
  research: ResearchBundle;
  /** Honest gaps: validation warnings such as COVERAGE_INCOMPLETE or MISSING_FLASHCARD. */
  warnings: KitIssue[];
  status: 'ready' | 'ready_with_gaps';
  /** Human-readable limitations collected along the way. */
  notes: string[];
}

/** Stored page text is capped to keep kits small; prompts use far less. */
const STORED_PAGE_CHARS = 8_000;

class StageTracker {
  private step = -1;
  private stage: GenerationStage = 'validating';

  constructor(
    private readonly reporter: PipelineReporter | undefined,
    private readonly signal: AbortSignal | undefined,
  ) {}

  get current(): GenerationStage {
    return this.stage;
  }

  private emit(status: StageStatus, detail: string | null) {
    const progress = Math.round(
      (Math.max(this.step, 0) / (PIPELINE_STAGE_SEQUENCE.length - 1)) * 100,
    );
    this.reporter?.({ stage: this.stage, step: this.step, status, detail, progress });
  }

  private advanceTo(stage: GenerationStage) {
    if (this.signal?.aborted) throw this.signal.reason;
    const next = PIPELINE_STAGE_SEQUENCE.findIndex((s, i) => i > this.step && s === stage);
    if (next === -1) throw new Error(`Stage ${stage} cannot follow ${this.stage}`);
    this.step = next;
    this.stage = stage;
  }

  start(stage: GenerationStage, detail: string | null = null) {
    this.advanceTo(stage);
    this.emit('running', detail);
  }

  update(detail: string) {
    this.emit('running', detail);
  }

  complete(detail: string | null = null) {
    this.emit('completed', detail);
  }

  skip(stage: GenerationStage, detail: string) {
    this.advanceTo(stage);
    this.emit('skipped', detail);
  }
}

function emptyKit(input: {
  company: string;
  companyUrl: string;
  jdChars: number;
  researchedAt: string;
  extraction: ExtractionResult;
  days: number;
}): InternalKit {
  return {
    source: {
      company: input.company,
      company_url: input.companyUrl,
      role: input.extraction.roleTitle,
      location: input.extraction.location,
      jd_chars: input.jdChars,
      researched_at: input.researchedAt,
      pages_used: [],
    },
    company_brief: { summary: '', what_they_do: '', sources: [], state: 'generated' },
    role: {
      title: input.extraction.roleTitle,
      seniority: input.extraction.seniority,
      responsibilities: input.extraction.responsibilities,
      requirements: input.extraction.requirements,
    },
    questions: [],
    flashcards: [],
    schedule: { days_available: input.days, days: [] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    counters: { question: 0, flashcard: 0 },
  };
}

export async function runPipeline(
  rawInput: unknown,
  deps: PipelineDeps,
  reporter?: PipelineReporter,
): Promise<PipelineResult> {
  const tracker = new StageTracker(reporter, deps.signal);
  try {
    return await execute(rawInput, deps, tracker);
  } catch (error) {
    if (isAppError(error)) throw error.atStage(tracker.current);
    throw error;
  }
}

async function execute(
  rawInput: unknown,
  deps: PipelineDeps,
  t: StageTracker,
): Promise<PipelineResult> {
  const { config, llm, signal } = deps;
  const now = deps.now ?? (() => new Date());
  const cached = createCachedLoader(deps.cache);
  const notes: string[] = [];

  // 1. validate input -------------------------------------------------------------------
  t.start('validating');
  const parsed = PipelineInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = issue.path.join('.');
    throw new AppError('INVALID_INPUT', field ? `${field}: ${issue.message}` : issue.message, {
      status: 400,
    });
  }
  const input = parsed.data;
  try {
    await assertUrlAllowed(parseHttpUrl(input.company_url), deps.policy, deps.lookup);
  } catch (error) {
    if (!isFetchFailure(error)) throw error;
    if (error.status === 'network_error') {
      throw new AppError(
        'COMPANY_UNREACHABLE',
        `The company website could not be reached: ${error.message}`,
        {
          retryable: true,
          status: 422,
        },
      );
    }
    throw new AppError('URL_NOT_ALLOWED', error.message, { status: 400 });
  }
  t.complete();

  // 2. requirements ---------------------------------------------------------------------
  t.start('extracting_requirements');
  const extraction = await cached(extractionCacheKey(input.jd), () =>
    extractRequirements(input.jd, llm, { signal }),
  );
  notes.push(...extraction.limitations);
  const mustCount = extraction.requirements.filter((r) => r.priority === 'must').length;
  t.complete(`${extraction.requirements.length} requirement(s), ${mustCount} must-have`);

  // 3. company website ------------------------------------------------------------------
  t.start('researching_company');
  const startedAt = now().toISOString();
  const crawl: CrawlResult = await cached(researchCacheKey(input.company_url), () =>
    crawlCompanySite(
      input.company_url,
      {
        maxPages: config.crawler.maxPages,
        maxDepth: config.crawler.maxDepth,
        maxConcurrency: config.crawler.maxConcurrency,
        requestTimeoutMs: config.crawler.requestTimeoutMs,
        maxPageBytes: config.crawler.maxPageBytes,
        maxRetries: config.crawler.maxRetries,
        userAgent: config.crawler.userAgent,
        policy: deps.policy,
        minDelayMs: config.crawler.crawlDelayMs,
      },
      { http: deps.http, onProgress: (detail) => t.update(detail), signal },
    ),
  );
  notes.push(...crawl.limitations);
  const okPages = crawl.pages.filter((p) => p.fetch_status === 'ok').length;
  const failedPages = crawl.pages.filter(
    (p) => p.fetch_status !== 'ok' && p.fetch_status !== 'robots_disallowed',
  ).length;
  t.complete(`${okPages} page(s) read${failedPages ? `, ${failedPages} failed` : ''}`);

  // 4. public interview discussion ------------------------------------------------------
  t.start('researching_interviews');
  const companyName = deriveCompanyName({
    jdCompany: extraction.companyName,
    siteName: crawl.homepage?.siteName,
    homepageTitle: crawl.homepage?.title,
    url: new URL(input.company_url),
  });
  const publicResearch: PublicResearch = await researchInterviews(
    { companyName, companyUrl: input.company_url },
    deps.search,
    { signal },
  );
  if (publicResearch.status === 'not_found') {
    notes.push("No public discussion of the company's interview process was found.");
  } else if (publicResearch.status === 'unavailable') {
    notes.push('Public discussion of the interview process could not be searched.');
  }
  t.complete(
    publicResearch.status === 'found'
      ? `${publicResearch.results.length} relevant discussion(s) found`
      : publicResearch.status === 'not_found'
        ? 'No public interview discussion found'
        : 'Public search unavailable',
  );

  const research: ResearchBundle = {
    company_url: input.company_url,
    company_name: companyName,
    pages: crawl.pages.map((page) => ({ ...page, text: page.text.slice(0, STORED_PAGE_CHARS) })),
    public_research: publicResearch,
    limitations: [...extraction.limitations, ...crawl.limitations],
    started_at: startedAt,
    finished_at: now().toISOString(),
  };

  // 5. company brief --------------------------------------------------------------------
  t.start('generating_company_brief');
  const briefResult = await generateCompanyBrief(
    {
      companyName,
      companyUrl: input.company_url,
      roleTitle: extraction.roleTitle,
      jd: input.jd,
      research,
    },
    llm,
    { signal },
  );
  t.complete(`${briefResult.brief.sources.length} source(s) cited`);

  const ctx: GenerationContext = {
    companyName,
    companyUrl: input.company_url,
    role: {
      title: extraction.roleTitle,
      seniority: extraction.seniority,
      responsibilities: extraction.responsibilities,
    },
    requirements: extraction.requirements,
    brief: briefResult.brief,
    research,
  };

  let kit = emptyKit({
    company: companyName,
    companyUrl: input.company_url,
    jdChars: input.jd.length,
    researchedAt: research.finished_at,
    extraction,
    days: input.days,
  });
  kit = { ...kit, company_brief: { ...briefResult.brief, state: 'generated' } };

  // 6. questions, one call per category -------------------------------------------------
  t.start('generating_questions');
  const plans = planFor(ctx);
  const settled = await Promise.allSettled(
    plans.map((plan) => generateCategoryQuestions(ctx, plan, llm, [], { signal })),
  );
  let firstFailure: unknown = null;
  settled.forEach((result, i) => {
    const plan = plans[i]!;
    if (result.status === 'fulfilled') {
      kit = appendQuestions(kit, result.value).kit; // IDs assigned in fixed category order
    } else {
      firstFailure ??= result.reason;
      if (!isAppError(result.reason)) throw result.reason;
      notes.push(`${plan.category} questions could not be generated (${result.reason.message}).`);
    }
  });
  if (kit.questions.length === 0 && firstFailure) throw firstFailure;
  t.complete(`${kit.questions.length} question(s) generated`);

  // 7–8. deterministic coverage check and bounded second pass --------------------------
  t.start('checking_coverage');
  let gapFillStarted = false;
  const loop = await runCoverageLoop(kit, {
    maxPasses: config.pipeline.maxCoveragePasses,
    generate: (uncovered, current) =>
      generateQuestionsForRequirements(ctx, uncovered, llm, current.questions, { signal }),
    onGenerate: (uncovered) => {
      if (!gapFillStarted) {
        gapFillStarted = true;
        t.start('generating_missing_questions', `${uncovered.length} uncovered requirement(s)`);
      } else {
        t.update(`Pass for ${uncovered.length} uncovered requirement(s)`);
      }
    },
  });
  kit = loop.kit;
  if (loop.error) notes.push(`Coverage gap-fill stopped early (${loop.error.message}).`);
  const uncovered = kit.coverage.uncovered_requirement_ids;
  if (!gapFillStarted) {
    t.complete('All must-have requirements are covered');
    t.skip('generating_missing_questions', 'Nothing to fill');
  } else {
    t.complete(
      uncovered.length === 0
        ? `All must-have requirements covered after ${loop.passes} pass(es)`
        : `${uncovered.length} must-have requirement(s) still uncovered after ${loop.passes} pass(es)`,
    );
  }

  // 9. flashcards -----------------------------------------------------------------------
  t.start('generating_flashcards');
  try {
    kit = appendFlashcards(
      kit,
      await generateFlashcards(ctx, kit.questions, llm, [], { signal }),
    ).kit;
    const carded = new Set(kit.flashcards.flatMap((f) => f.requirement_ids));
    const missing = ctx.requirements
      .filter((r) => r.priority === 'must' && !carded.has(r.id))
      .map((r) => r.id);
    if (missing.length > 0) {
      const extra = await generateFlashcardsForRequirements(
        ctx,
        missing,
        kit.questions,
        llm,
        kit.flashcards,
        {
          signal,
        },
      );
      kit = appendFlashcards(kit, extra, 'gap_fill').kit;
    }
  } catch (error) {
    if (!isAppError(error)) throw error;
    notes.push(`Some flashcards could not be generated (${error.message}).`);
  }
  t.complete(`${kit.flashcards.length} flashcard(s)`);

  // 10. deterministic schedule ----------------------------------------------------------
  t.start('building_schedule');
  kit = refreshDerived(kit, { passes: loop.passes, daysAvailable: input.days });
  const fitUrls = selectResearchSources(research, {
    focus: 'fit',
    maxPages: 3,
    maxPublic: 3,
  }).urlsByLabel;
  kit = {
    ...kit,
    source: {
      ...kit.source,
      pages_used: [...new Set([...briefResult.pagesUsed, ...fitUrls.values()])],
    },
  };
  t.complete(`${kit.schedule.days.length} day(s) planned`);

  // 11. validate before anything is persisted -------------------------------------------
  t.start('validating');
  const validation = validateKit(toExternalKit(kit), {
    maxCoveragePasses: config.pipeline.maxCoveragePasses,
  });
  if (!validation.valid) {
    throw new AppError('KIT_VALIDATION_FAILED', 'The generated kit did not pass validation.', {
      status: 500,
      retryable: true,
      details: { errors: validation.errors.slice(0, 20) },
    });
  }
  t.complete(
    validation.warnings.length > 0 ? `${validation.warnings.length} warning(s)` : 'Kit is valid',
  );

  return {
    kit,
    research,
    warnings: validation.warnings,
    status: kit.coverage.uncovered_requirement_ids.length > 0 ? 'ready_with_gaps' : 'ready',
    notes: [...new Set(notes)],
  };
}
