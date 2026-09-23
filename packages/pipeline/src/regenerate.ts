/**
 * Section regeneration. Each function changes ONE section and leaves the rest untouched:
 *
 *   regenerateCompanyBrief  company_brief only (refuses a pinned brief; an edited brief needs
 *                           explicit confirmation); pages_used gains any newly used URLs
 *   regenerateCategory      replaces only "generated" questions of one category; edited,
 *                           pinned and user-created questions survive; coverage gap-fill is
 *                           confined to the same category; derived sections are recomputed
 *   rebuildSchedule         deterministic, no LLM; can prioritise weak requirements
 */
import {
  AppError,
  type InternalKit,
  type QuestionCategory,
  type ResearchBundle,
} from '@prepforge/shared';
import type { PipelineConfig } from './config';
import { runCoverageLoop } from './coverage/coverage-loop';
import { refreshDerived } from './editing/derive';
import { replaceGeneratedQuestions } from './editing/merge';
import { toExternalKit } from './editing/project';
import { generateCompanyBrief } from './generation/company-brief';
import type { GenerationContext } from './generation/context';
import {
  generateCategoryQuestions,
  generateQuestionsForRequirements,
  planFor,
} from './generation/questions';
import type { LlmProvider } from './llm/provider';
import { validateKit } from './validation/validate-kit';

export interface RegenerateDeps {
  config: PipelineConfig;
  llm: LlmProvider;
  signal?: AbortSignal;
}

export function contextFromKit(kit: InternalKit, research: ResearchBundle): GenerationContext {
  return {
    companyName: kit.source.company,
    companyUrl: kit.source.company_url,
    role: {
      title: kit.role.title,
      seniority: kit.role.seniority,
      responsibilities: kit.role.responsibilities,
    },
    requirements: kit.role.requirements,
    brief: { summary: kit.company_brief.summary, what_they_do: kit.company_brief.what_they_do },
    research,
  };
}

function assertValid(kit: InternalKit, config: PipelineConfig): InternalKit {
  const result = validateKit(toExternalKit(kit), {
    maxCoveragePasses: config.pipeline.maxCoveragePasses,
  });
  if (!result.valid) {
    throw new AppError('KIT_VALIDATION_FAILED', 'The regenerated kit did not pass validation.', {
      status: 500,
      retryable: true,
      details: { errors: result.errors.slice(0, 20) },
    });
  }
  return kit;
}

export async function regenerateCompanyBrief(
  kit: InternalKit,
  research: ResearchBundle,
  deps: RegenerateDeps,
  options: { jd: string; force?: boolean },
): Promise<InternalKit> {
  if (kit.company_brief.state === 'pinned') {
    throw new AppError('CONFLICT', 'The company brief is pinned. Unpin it before regenerating.', {
      status: 409,
    });
  }
  if (kit.company_brief.state === 'edited' && !options.force) {
    throw new AppError(
      'CONFIRMATION_REQUIRED',
      'The company brief has been edited. Confirm that you want to replace your changes.',
      { status: 409 },
    );
  }
  const result = await generateCompanyBrief(
    {
      companyName: kit.source.company,
      companyUrl: kit.source.company_url,
      roleTitle: kit.role.title,
      jd: options.jd,
      research,
    },
    deps.llm,
    { signal: deps.signal },
  );
  return assertValid(
    {
      ...kit,
      company_brief: { ...result.brief, state: 'generated' },
      source: {
        ...kit.source,
        pages_used: [...new Set([...kit.source.pages_used, ...result.pagesUsed])],
      },
    },
    deps.config,
  );
}

export interface CategoryRegeneration {
  kit: InternalKit;
  removedIds: string[];
  addedIds: string[];
  notes: string[];
}

export async function regenerateCategory(
  kit: InternalKit,
  category: QuestionCategory,
  research: ResearchBundle,
  deps: RegenerateDeps,
  options: { weakRequirementIds?: ReadonlySet<string> } = {},
): Promise<CategoryRegeneration> {
  const ctx = contextFromKit(kit, research);
  const plan = planFor(ctx).find((p) => p.category === category)!;
  const preserved = kit.questions.filter((q) => q.category === category && q.state !== 'generated');
  const kept = kit.questions.filter((q) => q.category !== category || q.state !== 'generated');
  const count = plan.count === 0 ? 0 : Math.max(1, plan.count - preserved.length);

  const drafts = await generateCategoryQuestions(ctx, { ...plan, count }, deps.llm, kept, {
    signal: deps.signal,
  });
  const replaced = replaceGeneratedQuestions(kit, category, drafts);

  const loop = await runCoverageLoop(replaced.kit, {
    maxPasses: deps.config.pipeline.maxCoveragePasses,
    generate: (uncovered, current) =>
      generateQuestionsForRequirements(ctx, uncovered, deps.llm, current.questions, {
        forceCategory: category,
        signal: deps.signal,
      }),
  });
  const notes = loop.error ? [`Coverage gap-fill stopped early (${loop.error.message}).`] : [];
  const final = refreshDerived(loop.kit, {
    passes: loop.passes,
    weakRequirementIds: options.weakRequirementIds,
  });

  const before = new Set(kit.questions.map((q) => q.id));
  return {
    kit: assertValid(final, deps.config),
    removedIds: replaced.removedIds,
    addedIds: final.questions.filter((q) => !before.has(q.id)).map((q) => q.id),
    notes,
  };
}

/** Deterministic schedule rebuild (no LLM), optionally favouring weak requirements. */
export function rebuildSchedule(
  kit: InternalKit,
  options: { weakRequirementIds?: ReadonlySet<string> } = {},
): InternalKit {
  return refreshDerived(kit, { weakRequirementIds: options.weakRequirementIds });
}
