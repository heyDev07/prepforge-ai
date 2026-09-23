/**
 * Merge rules for regeneration. Only items in state "generated" are replaceable; "edited"
 * (including user-created) and "pinned" items always survive, as do all other categories.
 * New items get fresh IDs from the kit counters — an ID is never reused.
 */
import type {
  InternalFlashcard,
  InternalKit,
  InternalQuestion,
  ItemOrigin,
  QuestionCategory,
} from '@prepforge/shared';
import { insertAfterCategory } from './order';

export type NewQuestion = Omit<InternalQuestion, 'id' | 'state' | 'origin'>;
export type NewFlashcard = Omit<InternalFlashcard, 'id' | 'state' | 'origin'>;

function assignIds(
  kit: InternalKit,
  drafts: readonly NewQuestion[],
  origin: ItemOrigin,
): { questions: InternalQuestion[]; counter: number } {
  let counter = kit.counters.question;
  const questions = drafts.map((draft) => {
    counter += 1;
    return { ...draft, id: `q${counter}`, state: 'generated' as const, origin };
  });
  return { questions, counter };
}

/** Inserts questions after the last existing question of their category (or at the end). */
function insertByCategory(
  existing: readonly InternalQuestion[],
  added: readonly InternalQuestion[],
): InternalQuestion[] {
  return added.reduce<InternalQuestion[]>(insertAfterCategory, [...existing]);
}

/** Appends generated questions (e.g. coverage gap-fill) next to their category. */
export function appendQuestions(
  kit: InternalKit,
  drafts: readonly NewQuestion[],
  origin: ItemOrigin = 'generated',
): { kit: InternalKit; added: InternalQuestion[] } {
  const { questions: added, counter } = assignIds(kit, drafts, origin);
  return {
    kit: {
      ...kit,
      questions: insertByCategory(kit.questions, added),
      counters: { ...kit.counters, question: counter },
    },
    added,
  };
}

/**
 * Replaces the generated questions of one category. New questions fill the vacated positions
 * in order; extras go after the category's last question. Derived sections are NOT refreshed
 * here — the caller runs the coverage loop and rebuilds the schedule.
 */
export function replaceGeneratedQuestions(
  kit: InternalKit,
  category: QuestionCategory,
  drafts: readonly NewQuestion[],
): { kit: InternalKit; added: InternalQuestion[]; removedIds: string[] } {
  const { questions: added, counter } = assignIds(
    kit,
    drafts.map((draft) => ({ ...draft, category })),
    'generated',
  );
  const queue = [...added];
  const removedIds: string[] = [];
  const questions: InternalQuestion[] = [];
  for (const question of kit.questions) {
    if (question.category === category && question.state === 'generated') {
      removedIds.push(question.id);
      const replacement = queue.shift();
      if (replacement) questions.push(replacement);
    } else {
      questions.push(question);
    }
  }
  return {
    kit: {
      ...kit,
      questions: insertByCategory(questions, queue),
      counters: { ...kit.counters, question: counter },
    },
    added,
    removedIds,
  };
}

/** Appends generated flashcards with fresh IDs. */
export function appendFlashcards(
  kit: InternalKit,
  drafts: readonly NewFlashcard[],
  origin: ItemOrigin = 'generated',
): { kit: InternalKit; added: InternalFlashcard[] } {
  let counter = kit.counters.flashcard;
  const added = drafts.map((draft) => {
    counter += 1;
    return { ...draft, id: `f${counter}`, state: 'generated' as const, origin };
  });
  return {
    kit: {
      ...kit,
      flashcards: [...kit.flashcards, ...added],
      counters: { ...kit.counters, flashcard: counter },
    },
    added,
  };
}
