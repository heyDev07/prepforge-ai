/**
 * Flashcards are generated from the actual requirements and interview questions, then
 * sanitised by code. A bounded gap-fill call adds cards for must-haves that have none.
 */
import type { InternalFlashcard, InternalQuestion, Requirement } from '@prepforge/shared';
import {
  buildFlashcardsUser,
  flashcardsSystem,
  requirementsSource,
} from '../llm/prompts/generation';
import type { UntrustedSource } from '../llm/prompts/untrusted';
import type { LlmProvider } from '../llm/provider';
import { callStructured } from '../llm/structured-call';
import type { GenerationContext } from './context';
import { ALLOWED_KINDS } from './question-plan';
import { FlashcardsOutputSchema, sanitizeFlashcards, type NewFlashcard } from './sanitize';

const ANY_KIND = ALLOWED_KINDS['company-fit'];
const MAX_LINKS = 2;

/** Code decides how many cards: about 1.5 per requirement, between 4 and 20. */
export function flashcardCount(requirementCount: number): number {
  return Math.min(20, Math.max(4, Math.round(requirementCount * 1.5)));
}

function roleSource(ctx: GenerationContext): UntrustedSource {
  return {
    label: 'ROLE',
    type: 'role',
    content: JSON.stringify({
      title: ctx.role.title,
      seniority: ctx.role.seniority,
      company: ctx.companyName,
    }),
  };
}

function questionsSource(questions: readonly InternalQuestion[]): UntrustedSource {
  return {
    label: 'QUESTIONS',
    type: 'interview_questions',
    content: questions
      .slice(0, 30)
      .map((q) => `- [${q.requirement_ids.join(', ')}] ${q.prompt}`)
      .join('\n'),
  };
}

function existingSource(existing: readonly InternalFlashcard[]): UntrustedSource {
  return {
    label: 'EXISTING_FLASHCARDS',
    type: 'existing_flashcards',
    content: existing.length > 0 ? existing.map((f) => `- ${f.front}`).join('\n') : '(none)',
  };
}

export async function generateFlashcards(
  ctx: GenerationContext,
  questions: readonly InternalQuestion[],
  llm: LlmProvider,
  existing: readonly InternalFlashcard[] = [],
  options: { signal?: AbortSignal } = {},
): Promise<NewFlashcard[]> {
  const count = flashcardCount(ctx.requirements.length);
  const raw = await callStructured(llm, {
    task: 'flashcards',
    system: flashcardsSystem('plan'),
    user: buildFlashcardsUser({
      count,
      role: roleSource(ctx),
      requirements: requirementsSource('REQUIREMENTS', ctx.requirements),
      questions: questionsSource(questions),
      existing: existingSource(existing),
      mustIds: ctx.requirements.filter((r) => r.priority === 'must').map((r) => r.id),
    }),
    schema: FlashcardsOutputSchema,
    temperature: 0.4,
    maxOutputTokens: 4_000,
    signal: options.signal,
  });
  return sanitizeFlashcards(raw.flashcards, {
    requirements: ctx.requirements,
    allowedKinds: ANY_KIND,
    maxLinks: MAX_LINKS,
    existingFronts: existing.map((f) => f.front),
    limit: count,
  });
}

/** One card for each listed requirement (used for must-haves that ended up without a card). */
export async function generateFlashcardsForRequirements(
  ctx: GenerationContext,
  requirementIds: readonly string[],
  questions: readonly InternalQuestion[],
  llm: LlmProvider,
  existing: readonly InternalFlashcard[],
  options: { signal?: AbortSignal } = {},
): Promise<NewFlashcard[]> {
  const targets = requirementIds
    .map((id) => ctx.requirements.find((r) => r.id === id))
    .filter((r): r is Requirement => Boolean(r));
  if (targets.length === 0) return [];
  const raw = await callStructured(llm, {
    task: 'flashcards_gap_fill',
    system: flashcardsSystem('gap_fill'),
    user: buildFlashcardsUser({
      count: null,
      role: roleSource(ctx),
      requirements: requirementsSource('REQUIREMENTS', ctx.requirements),
      targets: requirementsSource('TARGET_REQUIREMENTS', targets),
      questions: questionsSource(questions),
      existing: existingSource(existing),
      mustIds: targets.map((r) => r.id),
    }),
    schema: FlashcardsOutputSchema,
    temperature: 0.3,
    maxOutputTokens: 2_000,
    signal: options.signal,
  });
  return sanitizeFlashcards(raw.flashcards, {
    requirements: ctx.requirements,
    allowedKinds: ANY_KIND,
    maxLinks: MAX_LINKS,
    mustReferenceOneOf: new Set(targets.map((r) => r.id)),
    existingFronts: existing.map((f) => f.front),
    limit: targets.length * 2,
  });
}
