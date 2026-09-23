/**
 * Pure edit operations on an InternalKit. Each returns a new kit with derived sections
 * (coverage, schedule) refreshed. State rules:
 *   - changing a generated item's content marks it "edited"
 *   - a pinned item stays pinned when edited; unpinning leaves it "edited" (still protected)
 *   - items created by the user are "edited" with origin "user"
 * Edited and pinned items survive regeneration; see merge.ts.
 */
import {
  AppError,
  MAX_DAYS,
  MIN_DAYS,
  type Difficulty,
  type InternalFlashcard,
  type InternalKit,
  type InternalQuestion,
  type ItemState,
  type QuestionCategory,
} from '@prepforge/shared';
import { refreshDerived, type DeriveOptions } from './derive';
import { insertAfterCategory } from './order';

export interface QuestionDraft {
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: Difficulty | number;
  requirement_ids: string[];
}

export interface QuestionPatch extends Partial<QuestionDraft> {
  pinned?: boolean;
}

export interface FlashcardDraft {
  front: string;
  back: string;
  requirement_ids: string[];
}

export interface FlashcardPatch extends Partial<FlashcardDraft> {
  pinned?: boolean;
}

export interface BriefPatch {
  summary?: string;
  what_they_do?: string;
  pinned?: boolean;
}

const invalid = (message: string) => new AppError('INVALID_INPUT', message, { status: 400 });
const notFound = (what: string) =>
  new AppError('NOT_FOUND', `${what} was not found.`, { status: 404 });

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw invalid(`${field} must not be empty.`);
  return trimmed;
}

function requireDifficulty(value: number): Difficulty {
  if (value !== 1 && value !== 2 && value !== 3) throw invalid('Difficulty must be 1, 2 or 3.');
  return value;
}

function requireRequirementIds(kit: InternalKit, ids: string[]): string[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw invalid('Select at least one requirement.');
  const known = new Set(kit.role.requirements.map((r) => r.id));
  const unknown = unique.filter((id) => !known.has(id));
  if (unknown.length > 0) throw invalid(`Unknown requirement(s): ${unknown.join(', ')}.`);
  return unique;
}

/** Next state after a user action. */
function nextState(
  current: ItemState,
  contentChanged: boolean,
  pinned: boolean | undefined,
): ItemState {
  if (pinned === true) return 'pinned';
  if (pinned === false) return 'edited';
  if (current === 'pinned') return 'pinned';
  return contentChanged ? 'edited' : current;
}

// ---------------------------------------------------------------------------------------
// questions

export function addQuestion(
  kit: InternalKit,
  draft: QuestionDraft,
  options: DeriveOptions = {},
): { kit: InternalKit; question: InternalQuestion } {
  const id = `q${kit.counters.question + 1}`;
  const question: InternalQuestion = {
    id,
    category: draft.category,
    prompt: requireText(draft.prompt, 'Prompt'),
    answer_outline: requireText(draft.answer_outline, 'Answer outline'),
    difficulty: requireDifficulty(draft.difficulty),
    requirement_ids: requireRequirementIds(kit, draft.requirement_ids),
    state: 'edited',
    origin: 'user',
  };
  const next: InternalKit = {
    ...kit,
    questions: insertAfterCategory(kit.questions, question),
    counters: { ...kit.counters, question: kit.counters.question + 1 },
  };
  return { kit: refreshDerived(next, options), question };
}

export function updateQuestion(
  kit: InternalKit,
  id: string,
  patch: QuestionPatch,
  options: DeriveOptions = {},
): { kit: InternalKit; question: InternalQuestion } {
  const current = kit.questions.find((q) => q.id === id);
  if (!current) throw notFound(`Question ${id}`);

  const updated: InternalQuestion = { ...current };
  if (patch.prompt !== undefined) updated.prompt = requireText(patch.prompt, 'Prompt');
  if (patch.answer_outline !== undefined) {
    updated.answer_outline = requireText(patch.answer_outline, 'Answer outline');
  }
  if (patch.difficulty !== undefined) updated.difficulty = requireDifficulty(patch.difficulty);
  if (patch.requirement_ids !== undefined) {
    updated.requirement_ids = requireRequirementIds(kit, patch.requirement_ids);
  }
  if (patch.category !== undefined) updated.category = patch.category;

  const contentChanged =
    updated.prompt !== current.prompt ||
    updated.answer_outline !== current.answer_outline ||
    updated.difficulty !== current.difficulty ||
    updated.category !== current.category ||
    updated.requirement_ids.join(',') !== current.requirement_ids.join(',');
  updated.state = nextState(current.state, contentChanged, patch.pinned);

  const questions =
    updated.category === current.category
      ? kit.questions.map((q) => (q.id === id ? updated : q))
      : // a moved question goes to the end of its new category
        insertAfterCategory(
          kit.questions.filter((q) => q.id !== id),
          updated,
        );
  return { kit: refreshDerived({ ...kit, questions }, options), question: updated };
}

export function deleteQuestion(
  kit: InternalKit,
  id: string,
  options: DeriveOptions = {},
): InternalKit {
  if (!kit.questions.some((q) => q.id === id)) throw notFound(`Question ${id}`);
  return refreshDerived({ ...kit, questions: kit.questions.filter((q) => q.id !== id) }, options);
}

/** Reorders one category. orderedIds must be exactly that category's question IDs. */
export function reorderQuestions(
  kit: InternalKit,
  category: QuestionCategory,
  orderedIds: string[],
  options: DeriveOptions = {},
): InternalKit {
  const inCategory = kit.questions.filter((q) => q.category === category);
  const expected = inCategory
    .map((q) => q.id)
    .sort()
    .join(',');
  if (
    [...orderedIds].sort().join(',') !== expected ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    throw invalid(`The new order must list each ${category} question exactly once.`);
  }
  const byId = new Map(inCategory.map((q) => [q.id, q]));
  let cursor = 0;
  const questions = kit.questions.map((q) =>
    q.category === category ? byId.get(orderedIds[cursor++]!)! : q,
  );
  return refreshDerived({ ...kit, questions }, options);
}

// ---------------------------------------------------------------------------------------
// flashcards

export function addFlashcard(
  kit: InternalKit,
  draft: FlashcardDraft,
): { kit: InternalKit; flashcard: InternalFlashcard } {
  const flashcard: InternalFlashcard = {
    id: `f${kit.counters.flashcard + 1}`,
    front: requireText(draft.front, 'Front'),
    back: requireText(draft.back, 'Back'),
    requirement_ids: requireRequirementIds(kit, draft.requirement_ids),
    state: 'edited',
    origin: 'user',
  };
  const next: InternalKit = {
    ...kit,
    flashcards: [...kit.flashcards, flashcard],
    counters: { ...kit.counters, flashcard: kit.counters.flashcard + 1 },
  };
  return { kit: refreshDerived(next), flashcard };
}

export function updateFlashcard(
  kit: InternalKit,
  id: string,
  patch: FlashcardPatch,
): { kit: InternalKit; flashcard: InternalFlashcard } {
  const current = kit.flashcards.find((f) => f.id === id);
  if (!current) throw notFound(`Flashcard ${id}`);
  const updated: InternalFlashcard = { ...current };
  if (patch.front !== undefined) updated.front = requireText(patch.front, 'Front');
  if (patch.back !== undefined) updated.back = requireText(patch.back, 'Back');
  if (patch.requirement_ids !== undefined) {
    updated.requirement_ids = requireRequirementIds(kit, patch.requirement_ids);
  }
  const contentChanged =
    updated.front !== current.front ||
    updated.back !== current.back ||
    updated.requirement_ids.join(',') !== current.requirement_ids.join(',');
  updated.state = nextState(current.state, contentChanged, patch.pinned);
  return {
    kit: { ...kit, flashcards: kit.flashcards.map((f) => (f.id === id ? updated : f)) },
    flashcard: updated,
  };
}

export function deleteFlashcard(kit: InternalKit, id: string): InternalKit {
  if (!kit.flashcards.some((f) => f.id === id)) throw notFound(`Flashcard ${id}`);
  // the flashcard count affects schedule minutes, so derived sections are refreshed
  return refreshDerived({ ...kit, flashcards: kit.flashcards.filter((f) => f.id !== id) });
}

// ---------------------------------------------------------------------------------------
// company brief and days

export function updateCompanyBrief(kit: InternalKit, patch: BriefPatch): InternalKit {
  const current = kit.company_brief;
  const summary =
    patch.summary !== undefined ? requireText(patch.summary, 'Summary') : current.summary;
  const whatTheyDo =
    patch.what_they_do !== undefined
      ? requireText(patch.what_they_do, 'What they do')
      : current.what_they_do;
  const contentChanged = summary !== current.summary || whatTheyDo !== current.what_they_do;
  return {
    ...kit,
    company_brief: {
      ...current,
      summary,
      what_they_do: whatTheyDo,
      state: nextState(current.state, contentChanged, patch.pinned),
    },
  };
}

export function setDaysAvailable(
  kit: InternalKit,
  days: number,
  options: DeriveOptions = {},
): InternalKit {
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw invalid(`Days must be a whole number between ${MIN_DAYS} and ${MAX_DAYS}.`);
  }
  return refreshDerived(kit, { ...options, daysAvailable: days });
}
