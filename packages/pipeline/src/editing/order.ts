import type { InternalQuestion } from '@prepforge/shared';

/** Places a question after the last question of its category (or at the end). */
export function insertAfterCategory(
  questions: readonly InternalQuestion[],
  question: InternalQuestion,
): InternalQuestion[] {
  const result = [...questions];
  const lastIndex = result.map((q) => q.category).lastIndexOf(question.category);
  result.splice(lastIndex === -1 ? result.length : lastIndex + 1, 0, question);
  return result;
}
