/**
 * Question generation — one focused LLM call per category, plus gap-fill calls that receive
 * ONLY the uncovered requirements. The model writes; code decides counts, eligible
 * requirements, reference validity and IDs.
 */
import type { InternalQuestion, QuestionCategory, Requirement } from '@prepforge/shared';
import type { NewQuestion } from '../editing/merge';
import { buildQuestionsUser, questionsSystem, requirementsSource } from '../llm/prompts/generation';
import type { UntrustedSource } from '../llm/prompts/untrusted';
import type { LlmProvider } from '../llm/provider';
import { callStructured } from '../llm/structured-call';
import { selectResearchSources } from '../research/excerpts';
import { findInterviewProcess, INTERVIEW_FORMAT_LABELS } from '../research/interview-process';
import type { GenerationContext } from './context';
import { ALLOWED_KINDS, gapFillCategory, planQuestions, type CategoryPlan } from './question-plan';
import { QuestionsOutputSchema, sanitizeQuestions } from './sanitize';

const MAX_LINKS = 3;

function roleSource(ctx: GenerationContext): UntrustedSource {
  return {
    label: 'ROLE',
    type: 'role',
    content: JSON.stringify({
      title: ctx.role.title,
      seniority: ctx.role.seniority,
      company: ctx.companyName,
      responsibilities: ctx.role.responsibilities.slice(0, 8),
    }),
  };
}

function existingSource(
  existing: readonly InternalQuestion[],
  label = 'EXISTING_QUESTIONS',
): UntrustedSource {
  return {
    label,
    type: 'existing_questions',
    content: existing.length > 0 ? existing.map((q) => `- ${q.prompt}`).join('\n') : '(none)',
  };
}

function companySource(ctx: GenerationContext): UntrustedSource | undefined {
  if (!ctx.brief) return undefined;
  return {
    label: 'COMPANY',
    type: 'company_brief',
    content: `${ctx.brief.what_they_do}\n${ctx.brief.summary}`,
  };
}

export function planFor(ctx: GenerationContext): CategoryPlan[] {
  const okPages = ctx.research.pages.filter((p) => p.fetch_status === 'ok').length;
  return planQuestions(ctx.requirements, ctx.role.seniority, {
    researchIsThin: okPages <= 1 && ctx.research.public_research.status !== 'found',
    interviewFormats: findInterviewProcess(ctx.research).formats,
  });
}

/** The interview process found in research, as prompt input (labels come from code). */
function processFor(ctx: GenerationContext, withSources: boolean) {
  const found = findInterviewProcess(ctx.research);
  return {
    formats: found.formats.map((format) => INTERVIEW_FORMAT_LABELS[format]),
    sources: withSources ? found.sources : [],
  };
}

/** Generates the planned questions for one category. Returns [] when the plan asks for none. */
export async function generateCategoryQuestions(
  ctx: GenerationContext,
  plan: CategoryPlan,
  llm: LlmProvider,
  existing: readonly InternalQuestion[],
  options: { signal?: AbortSignal } = {},
): Promise<NewQuestion[]> {
  if (plan.count === 0 || plan.requirementIds.length === 0) return [];
  const eligible = plan.requirementIds
    .map((id) => ctx.requirements.find((r) => r.id === id))
    .filter((r): r is Requirement => Boolean(r));
  const sameCategory = existing.filter((q) => q.category === plan.category);
  const research =
    plan.category === 'company-fit'
      ? selectResearchSources(ctx.research, { focus: 'fit', maxPages: 3, maxPublic: 3 }).sources
      : undefined;

  const raw = await callStructured(llm, {
    task: `questions:${plan.category}`,
    system: questionsSystem(plan.category, 'plan'),
    user: buildQuestionsUser({
      category: plan.category,
      count: plan.count,
      role: roleSource(ctx),
      requirements: requirementsSource('REQUIREMENTS', eligible),
      existing: existingSource(sameCategory),
      company:
        plan.category === 'company-fit' || plan.category === 'system-design'
          ? companySource(ctx)
          : undefined,
      research,
      // company-fit already receives the interview pages among its research sources
      process: processFor(ctx, plan.category !== 'company-fit'),
      mustIds: plan.mustIds,
    }),
    schema: QuestionsOutputSchema,
    temperature: 0.4,
    maxOutputTokens: 4_000,
    signal: options.signal,
  });

  return sanitizeQuestions(raw.questions, {
    category: plan.category,
    requirements: eligible,
    allowedKinds: plan.allowedKinds,
    maxLinks: MAX_LINKS,
    existingPrompts: existing.map((q) => q.prompt),
    limit: plan.count,
  });
}

function namedGenerator(category: QuestionCategory) {
  return (
    ctx: GenerationContext,
    llm: LlmProvider,
    existing: readonly InternalQuestion[] = [],
    options: { signal?: AbortSignal } = {},
  ) =>
    generateCategoryQuestions(
      ctx,
      planFor(ctx).find((p) => p.category === category)!,
      llm,
      existing,
      options,
    );
}

export const generateTechnicalQuestions = namedGenerator('technical');
export const generateBehaviouralQuestions = namedGenerator('behavioural');
export const generateSystemDesignQuestions = namedGenerator('system-design');
export const generateCompanyFitQuestions = namedGenerator('company-fit');

/**
 * Coverage gap-fill: questions ONLY for the given (uncovered) requirements. Requirements are
 * grouped by the category that fits their kind, one call per group, unless a category is
 * forced (regenerating one category must not add questions to others).
 */
export async function generateQuestionsForRequirements(
  ctx: GenerationContext,
  requirementIds: readonly string[],
  llm: LlmProvider,
  existing: readonly InternalQuestion[],
  options: { forceCategory?: QuestionCategory; signal?: AbortSignal } = {},
): Promise<NewQuestion[]> {
  const targets = requirementIds
    .map((id) => ctx.requirements.find((r) => r.id === id))
    .filter((r): r is Requirement => Boolean(r));

  const groups = new Map<QuestionCategory, Requirement[]>();
  for (const requirement of targets) {
    const category = options.forceCategory ?? gapFillCategory(requirement.kind);
    if (!ALLOWED_KINDS[category].includes(requirement.kind)) continue; // cannot be covered here
    groups.set(category, [...(groups.get(category) ?? []), requirement]);
  }

  const results: NewQuestion[] = [];
  for (const [category, group] of groups) {
    const raw = await callStructured(llm, {
      task: `questions_gap_fill:${category}`,
      system: questionsSystem(category, 'gap_fill'),
      user: buildQuestionsUser({
        category,
        count: null,
        role: roleSource(ctx),
        requirements: requirementsSource('REQUIREMENTS', ctx.requirements),
        targets: requirementsSource('TARGET_REQUIREMENTS', group),
        existing: existingSource(existing.filter((q) => q.category === category)),
        company: companySource(ctx),
        process: processFor(ctx, false),
        mustIds: group.map((r) => r.id),
      }),
      schema: QuestionsOutputSchema,
      temperature: 0.3,
      maxOutputTokens: 3_000,
      signal: options.signal,
    });
    results.push(
      ...sanitizeQuestions(raw.questions, {
        category,
        requirements: ctx.requirements,
        allowedKinds: ALLOWED_KINDS[category],
        maxLinks: MAX_LINKS,
        mustReferenceOneOf: new Set(group.map((r) => r.id)),
        existingPrompts: [...existing, ...results].map((q) => q.prompt),
        limit: group.length * 2,
      }),
    );
  }
  return results;
}
