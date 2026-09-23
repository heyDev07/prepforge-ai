/**
 * Transparent question scoring used to order the study plan.
 *
 *   +3  links a must-have requirement
 *   +d  difficulty (1–3)
 *   +1  technical or system-design question
 *   +2  links a weak requirement (low practice confidence)
 *   +2  is the ONLY question covering some must-have requirement
 */
import type { Question, Requirement } from '@prepforge/shared';

export const SCORE_WEIGHTS = {
  mustRequirement: 3,
  technicalCategory: 1,
  weakRequirement: 2,
  soleCoverage: 2,
} as const;

/** Estimated study time per question, by difficulty. */
export const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 10, 2: 15, 3: 25 };

export function questionMinutes(question: Pick<Question, 'difficulty'>): number {
  return MINUTES_BY_DIFFICULTY[question.difficulty] ?? 15;
}

export interface ScoredQuestion<Q extends Question = Question> {
  question: Q;
  index: number;
  score: number;
  minutes: number;
}

export function scoreQuestions<Q extends Question>(
  requirements: readonly Requirement[],
  questions: readonly Q[],
  weakRequirementIds: ReadonlySet<string> = new Set(),
): ScoredQuestion<Q>[] {
  const must = new Set(requirements.filter((r) => r.priority === 'must').map((r) => r.id));
  const coverers = new Map<string, number>();
  for (const question of questions) {
    for (const id of new Set(question.requirement_ids)) {
      coverers.set(id, (coverers.get(id) ?? 0) + 1);
    }
  }

  return questions.map((question, index) => {
    const ids = question.requirement_ids;
    let score = question.difficulty;
    if (ids.some((id) => must.has(id))) score += SCORE_WEIGHTS.mustRequirement;
    if (question.category === 'technical' || question.category === 'system-design') {
      score += SCORE_WEIGHTS.technicalCategory;
    }
    if (ids.some((id) => weakRequirementIds.has(id))) score += SCORE_WEIGHTS.weakRequirement;
    if (ids.some((id) => must.has(id) && coverers.get(id) === 1)) {
      score += SCORE_WEIGHTS.soleCoverage;
    }
    return { question, index, score, minutes: questionMinutes(question) };
  });
}

/** Highest score first; ties keep the original question order, so the result is deterministic. */
export function byPriority<Q extends Question>(a: ScoredQuestion<Q>, b: ScoredQuestion<Q>): number {
  return b.score - a.score || a.index - b.index;
}
