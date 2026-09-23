/**
 * Code — not the model — decides how many questions each category gets and which
 * requirements each generator may reference.
 *
 *   technical      technical + domain requirements   clamp(2·must + nice, 3, 10)  (0 if none)
 *   behavioural    behavioural requirements          clamp(2·n, 3, 6); 2 if there are none
 *                  (falls back to all requirements)
 *   system-design  technical + domain requirements   junior 1 · mid/unspecified 2 · senior+ 3 (0 if none)
 *   company-fit    all requirements                  3, or 2 when research is thin
 */
import type { QuestionCategory, Requirement, RequirementKind } from '@prepforge/shared';

export interface CategoryPlan {
  category: QuestionCategory;
  count: number;
  /** Requirements this generator may reference, must-haves first. */
  requirementIds: string[];
  /** Must-have requirements the generator should cover first. */
  mustIds: string[];
  allowedKinds: readonly RequirementKind[];
}

export const ALLOWED_KINDS: Record<QuestionCategory, readonly RequirementKind[]> = {
  technical: ['technical', 'domain'],
  'system-design': ['technical', 'domain'],
  behavioural: ['technical', 'behavioural', 'domain'],
  'company-fit': ['technical', 'behavioural', 'domain'],
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function systemDesignCount(seniority: string): number {
  const s = seniority.toLowerCase();
  if (/\b(intern|junior|jr|entry|graduate|associate)\b/.test(s)) return 1;
  if (/\b(senior|sr|staff|principal|lead|head|director|manager|architect)\b/.test(s)) return 3;
  return 2;
}

function mustFirst(requirements: Requirement[]): Requirement[] {
  return [
    ...requirements.filter((r) => r.priority === 'must'),
    ...requirements.filter((r) => r.priority !== 'must'),
  ];
}

function plan(category: QuestionCategory, count: number, eligible: Requirement[]): CategoryPlan {
  const ordered = mustFirst(eligible);
  return {
    category,
    count,
    requirementIds: ordered.map((r) => r.id),
    mustIds: ordered.filter((r) => r.priority === 'must').map((r) => r.id),
    allowedKinds: ALLOWED_KINDS[category],
  };
}

export function planQuestions(
  requirements: Requirement[],
  seniority: string,
  options: { researchIsThin: boolean },
): CategoryPlan[] {
  const technical = requirements.filter((r) => r.kind === 'technical' || r.kind === 'domain');
  const behavioural = requirements.filter((r) => r.kind === 'behavioural');
  const technicalMust = technical.filter((r) => r.priority === 'must').length;

  return [
    plan(
      'technical',
      technical.length === 0
        ? 0
        : clamp(2 * technicalMust + (technical.length - technicalMust), 3, 10),
      technical,
    ),
    plan(
      'behavioural',
      behavioural.length === 0 ? 2 : clamp(2 * behavioural.length, 3, 6),
      behavioural.length === 0 ? requirements : behavioural,
    ),
    plan('system-design', technical.length === 0 ? 0 : systemDesignCount(seniority), technical),
    plan('company-fit', options.researchIsThin ? 2 : 3, requirements),
  ];
}

/** The category a gap-fill question for this requirement belongs to. */
export function gapFillCategory(kind: RequirementKind): QuestionCategory {
  return kind === 'behavioural' ? 'behavioural' : 'technical';
}
