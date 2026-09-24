/**
 * Deterministic clean-up of generated items before they enter a kit. The model only suggests
 * requirement links; code keeps a link only if the requirement exists and its kind is allowed
 * for the category, and drops items left without any valid link.
 */
import type { Difficulty, QuestionCategory, Requirement, RequirementKind } from '@prepforge/shared';
import { z } from 'zod';
import type { NewFlashcard, NewQuestion } from '../editing/merge';
import { normalizeForMatch } from '../text/match';
import { stripInvisible, truncate } from '../text/sanitize';

export type { NewFlashcard };

const outline = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    Array.isArray(value)
      ? value.map((line) => `- ${line.replace(/^[-*•\s]+/, '')}`).join('\n')
      : value,
  );

export const RawQuestionSchema = z.object({
  prompt: z.string().trim().min(1),
  answer_outline: outline,
  difficulty: z.coerce.number().catch(2),
  requirement_ids: z.array(z.coerce.string()).default([]),
});
export const QuestionsOutputSchema = z.object({ questions: z.array(RawQuestionSchema).max(40) });
export type RawQuestion = z.infer<typeof RawQuestionSchema>;

export const RawFlashcardSchema = z.object({
  front: z.string().trim().min(1),
  back: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v.join('\n') : v)),
  requirement_ids: z.array(z.coerce.string()).default([]),
});
export const FlashcardsOutputSchema = z.object({ flashcards: z.array(RawFlashcardSchema).max(60) });
export type RawFlashcard = z.infer<typeof RawFlashcardSchema>;

/** Requirement IDs the model sometimes leaks into prose: "(r5)", "(r1, r2)", "[r3]". */
const LEAKED_IDS = /\s*[([]\s*r\d+(?:\s*,\s*r\d+)*\s*[)\]]/gi;

function cleanText(text: string, max: number): string {
  return truncate(
    stripInvisible(text)
      .replace(LEAKED_IDS, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    max,
  );
}

function clampDifficulty(value: number): Difficulty {
  if (!Number.isFinite(value)) return 2;
  return Math.min(3, Math.max(1, Math.round(value))) as Difficulty;
}

export interface LinkRules {
  requirements: readonly Requirement[];
  allowedKinds: readonly RequirementKind[];
  maxLinks: number;
  /** When set, an item must reference at least one of these IDs (gap-fill targets). */
  mustReferenceOneOf?: ReadonlySet<string>;
}

/** Normalises ("R2", " r2 ") and filters requirement IDs by existence and allowed kind. */
export function sanitizeRequirementIds(ids: readonly string[], rules: LinkRules): string[] {
  const kinds = new Map(rules.requirements.map((r) => [r.id, r.kind]));
  const kept: string[] = [];
  for (const raw of ids) {
    const id = raw.trim().toLowerCase().replace(/\s+/g, '');
    const kind = kinds.get(id);
    if (!kind || !rules.allowedKinds.includes(kind) || kept.includes(id)) continue;
    kept.push(id);
    if (kept.length >= rules.maxLinks) break;
  }
  if (rules.mustReferenceOneOf && !kept.some((id) => rules.mustReferenceOneOf!.has(id))) return [];
  return kept;
}

export function sanitizeQuestions(
  raw: readonly RawQuestion[],
  options: LinkRules & {
    category: QuestionCategory;
    existingPrompts: readonly string[];
    limit: number;
  },
): NewQuestion[] {
  const seen = new Set(options.existingPrompts.map(normalizeForMatch));
  const result: NewQuestion[] = [];
  for (const item of raw) {
    if (result.length >= options.limit) break;
    const requirementIds = sanitizeRequirementIds(item.requirement_ids, options);
    const prompt = cleanText(item.prompt, 600);
    const answerOutline = cleanText(item.answer_outline, 2_000);
    const key = normalizeForMatch(prompt);
    if (requirementIds.length === 0 || !prompt || !answerOutline || seen.has(key)) continue;
    seen.add(key);
    result.push({
      category: options.category,
      prompt,
      answer_outline: answerOutline,
      difficulty: clampDifficulty(item.difficulty),
      requirement_ids: requirementIds,
    });
  }
  return result;
}

export function sanitizeFlashcards(
  raw: readonly RawFlashcard[],
  options: LinkRules & { existingFronts: readonly string[]; limit: number },
): NewFlashcard[] {
  const seen = new Set(options.existingFronts.map(normalizeForMatch));
  const result: NewFlashcard[] = [];
  for (const item of raw) {
    if (result.length >= options.limit) break;
    const requirementIds = sanitizeRequirementIds(item.requirement_ids, options);
    const front = cleanText(item.front, 300);
    const back = cleanText(item.back, 1_000);
    const key = normalizeForMatch(front);
    if (requirementIds.length === 0 || !front || !back || seen.has(key)) continue;
    seen.add(key);
    result.push({ front, back, requirement_ids: requirementIds });
  }
  return result;
}
