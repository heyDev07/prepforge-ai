import {
  QUESTION_CATEGORIES,
  type Question,
  type QuestionCategory,
  type Requirement,
} from '@prepforge/shared';
import { truncate } from '../text/sanitize';

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

export const MOCK_INTERVIEW_FOCUS = 'Mock interview & review';
export const EMPTY_DAY_FOCUS = 'Company & role research review';

/** Most frequent category of the day's questions (ties broken by the fixed category order). */
function dominantCategory(questions: readonly Question[]): QuestionCategory {
  const counts = new Map<QuestionCategory, number>();
  for (const q of questions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  let best: QuestionCategory = questions[0]?.category ?? 'technical';
  for (const category of QUESTION_CATEGORIES) {
    if ((counts.get(category) ?? 0) > (counts.get(best) ?? 0)) best = category;
  }
  return best;
}

/** The first distinct requirement texts touched by the day's questions (in priority order). */
function topRequirements(
  questions: readonly Question[],
  requirementsById: ReadonlyMap<string, Requirement>,
  limit: number,
): string[] {
  const texts: string[] = [];
  for (const q of questions) {
    for (const id of q.requirement_ids) {
      const text = requirementsById.get(id)?.text;
      if (text && !texts.includes(text)) texts.push(text);
      if (texts.length >= limit) return texts.map((t) => truncate(t, 48));
    }
  }
  return texts.map((t) => truncate(t, 48));
}

export function learningFocus(
  questions: readonly Question[],
  requirementsById: ReadonlyMap<string, Requirement>,
): string {
  if (questions.length === 0) return EMPTY_DAY_FOCUS;
  const label = CATEGORY_LABELS[dominantCategory(questions)];
  const topics = topRequirements(questions, requirementsById, 2);
  return topics.length > 0 ? `${label}: ${topics.join('; ')}` : label;
}

export function reviewFocus(
  questions: readonly Question[],
  requirementsById: ReadonlyMap<string, Requirement>,
): string {
  if (questions.length === 0) return EMPTY_DAY_FOCUS;
  const topics = topRequirements(questions, requirementsById, 2);
  return topics.length > 0 ? `Review: ${topics.join('; ')}` : 'Review';
}
