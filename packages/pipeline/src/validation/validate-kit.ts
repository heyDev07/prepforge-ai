/**
 * validateKit(kit): the gate every kit passes before it is persisted or exported.
 *
 * Errors (kit is invalid):
 *   - Appendix A shape: exact fields, types, enums, integer difficulty 1–3, integer minutes
 *   - unique IDs; every reference points at a real requirement / question
 *   - schedule: exactly days_available days, numbered 1..N
 *   - coverage field equals a fresh deterministic recomputation; passes within limits
 *   - every covered must-have requirement appears in the schedule
 * Warnings (kit is valid but has honest gaps):
 *   - COVERAGE_INCOMPLETE: must-have requirements without any question
 *   - MISSING_FLASHCARD: must-have requirements without a flashcard
 *   - EMPTY_DAY: schedule days without questions
 */
import { KitSchema, type Kit } from '@prepforge/shared';
import { findUncoveredRequirements } from '../coverage/check-coverage';

export type KitIssueCode =
  | 'SCHEMA'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_REQUIREMENT'
  | 'UNKNOWN_QUESTION'
  | 'DAY_COUNT'
  | 'DAY_SEQUENCE'
  | 'COVERAGE_MISMATCH'
  | 'PASSES_OUT_OF_RANGE'
  | 'UNSCHEDULED_REQUIREMENT'
  | 'COVERAGE_INCOMPLETE'
  | 'MISSING_FLASHCARD'
  | 'EMPTY_DAY';

export interface KitIssue {
  code: KitIssueCode;
  path: string;
  message: string;
}

export interface KitValidationResult {
  valid: boolean;
  errors: KitIssue[];
  warnings: KitIssue[];
  /** The parsed kit when the shape is valid. */
  kit: Kit | null;
}

export interface ValidateKitOptions {
  maxCoveragePasses?: number;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export function validateKit(input: unknown, options: ValidateKitOptions = {}): KitValidationResult {
  const parsed = KitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      kit: null,
      warnings: [],
      errors: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  const kit = parsed.data;
  const errors: KitIssue[] = [];
  const warnings: KitIssue[] = [];
  const requirementIds = new Set(kit.role.requirements.map((r) => r.id));
  const questionIds = new Set(kit.questions.map((q) => q.id));

  // unique IDs
  for (const [path, ids] of [
    ['role.requirements', kit.role.requirements.map((r) => r.id)],
    ['questions', kit.questions.map((q) => q.id)],
    ['flashcards', kit.flashcards.map((f) => f.id)],
  ] as const) {
    for (const id of duplicates(ids)) {
      errors.push({ code: 'DUPLICATE_ID', path, message: `ID "${id}" is used more than once.` });
    }
  }

  // references
  kit.questions.forEach((question, index) => {
    for (const id of question.requirement_ids) {
      if (!requirementIds.has(id)) {
        errors.push({
          code: 'UNKNOWN_REQUIREMENT',
          path: `questions.${index}.requirement_ids`,
          message: `Question ${question.id} references unknown requirement "${id}".`,
        });
      }
    }
    for (const id of duplicates(question.requirement_ids)) {
      errors.push({
        code: 'DUPLICATE_ID',
        path: `questions.${index}.requirement_ids`,
        message: `Question ${question.id} lists requirement "${id}" twice.`,
      });
    }
  });
  kit.flashcards.forEach((card, index) => {
    for (const id of card.requirement_ids) {
      if (!requirementIds.has(id)) {
        errors.push({
          code: 'UNKNOWN_REQUIREMENT',
          path: `flashcards.${index}.requirement_ids`,
          message: `Flashcard ${card.id} references unknown requirement "${id}".`,
        });
      }
    }
  });

  // schedule integrity
  const { schedule } = kit;
  if (schedule.days.length !== schedule.days_available) {
    errors.push({
      code: 'DAY_COUNT',
      path: 'schedule.days',
      message: `Schedule has ${schedule.days.length} day(s) but days_available is ${schedule.days_available}.`,
    });
  }
  schedule.days.forEach((day, index) => {
    if (day.day !== index + 1) {
      errors.push({
        code: 'DAY_SEQUENCE',
        path: `schedule.days.${index}.day`,
        message: `Day at position ${index + 1} is numbered ${day.day}.`,
      });
    }
    for (const id of day.question_ids) {
      if (!questionIds.has(id)) {
        errors.push({
          code: 'UNKNOWN_QUESTION',
          path: `schedule.days.${index}.question_ids`,
          message: `Day ${day.day} references unknown question "${id}".`,
        });
      }
    }
    for (const id of duplicates(day.question_ids)) {
      errors.push({
        code: 'DUPLICATE_ID',
        path: `schedule.days.${index}.question_ids`,
        message: `Day ${day.day} lists question "${id}" twice.`,
      });
    }
    if (day.question_ids.length === 0) {
      warnings.push({
        code: 'EMPTY_DAY',
        path: `schedule.days.${index}`,
        message: `Day ${day.day} has no questions.`,
      });
    }
  });

  // coverage integrity
  const uncovered = findUncoveredRequirements(kit.role.requirements, kit.questions);
  const reported = [...kit.coverage.uncovered_requirement_ids].sort().join(',');
  if (reported !== [...uncovered].sort().join(',')) {
    errors.push({
      code: 'COVERAGE_MISMATCH',
      path: 'coverage.uncovered_requirement_ids',
      message: `Coverage reports [${kit.coverage.uncovered_requirement_ids.join(', ')}] but the questions leave [${uncovered.join(', ')}] uncovered.`,
    });
  }
  const maxPasses = options.maxCoveragePasses;
  if (maxPasses !== undefined && kit.coverage.passes > maxPasses) {
    errors.push({
      code: 'PASSES_OUT_OF_RANGE',
      path: 'coverage.passes',
      message: `Coverage passes (${kit.coverage.passes}) exceed the maximum of ${maxPasses}.`,
    });
  }
  if (uncovered.length > 0) {
    warnings.push({
      code: 'COVERAGE_INCOMPLETE',
      path: 'coverage.uncovered_requirement_ids',
      message: `Must-have requirement(s) without any question: ${uncovered.join(', ')}.`,
    });
  }

  // every covered must-have requirement is scheduled
  const questionsById = new Map(kit.questions.map((q) => [q.id, q]));
  const scheduledRequirements = new Set(
    schedule.days.flatMap((day) =>
      day.question_ids.flatMap((id) => questionsById.get(id)?.requirement_ids ?? []),
    ),
  );
  const uncoveredSet = new Set(uncovered);
  for (const requirement of kit.role.requirements) {
    if (requirement.priority !== 'must' || uncoveredSet.has(requirement.id)) continue;
    if (!scheduledRequirements.has(requirement.id)) {
      errors.push({
        code: 'UNSCHEDULED_REQUIREMENT',
        path: 'schedule.days',
        message: `Must-have requirement ${requirement.id} is covered by a question but never scheduled.`,
      });
    }
  }

  // flashcards for must-haves (warning only)
  const carded = new Set(kit.flashcards.flatMap((card) => card.requirement_ids));
  for (const requirement of kit.role.requirements) {
    if (requirement.priority === 'must' && !carded.has(requirement.id)) {
      warnings.push({
        code: 'MISSING_FLASHCARD',
        path: 'flashcards',
        message: `Must-have requirement ${requirement.id} has no flashcard.`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings, kit };
}
