/**
 * Deterministic coverage check — pure application code, never an LLM judgement.
 *
 *   must      = requirements with priority "must"
 *   covered   = every requirement ID referenced by any question
 *   uncovered = must requirements that are not covered (in requirement order)
 *
 * Nice-to-have requirements never block completion.
 */
import type { Coverage, Question, Requirement } from '@prepforge/shared';

export function findUncoveredRequirements(
  requirements: readonly Pick<Requirement, 'id' | 'priority'>[],
  questions: readonly Pick<Question, 'requirement_ids'>[],
): string[] {
  const covered = new Set(questions.flatMap((question) => question.requirement_ids));
  return requirements
    .filter((requirement) => requirement.priority === 'must' && !covered.has(requirement.id))
    .map((requirement) => requirement.id);
}

export function checkCoverage(
  requirements: readonly Pick<Requirement, 'id' | 'priority'>[],
  questions: readonly Pick<Question, 'requirement_ids'>[],
  passes: number,
): Coverage {
  return { uncovered_requirement_ids: findUncoveredRequirements(requirements, questions), passes };
}
