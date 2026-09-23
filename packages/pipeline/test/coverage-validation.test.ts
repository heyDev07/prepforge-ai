import { KitSchema } from '@prepforge/shared';
import { describe, expect, it } from 'vitest';
import { checkCoverage, findUncoveredRequirements } from '../src/coverage/check-coverage';
import { toExternalKit } from '../src/editing/project';
import { validateKit } from '../src/validation/validate-kit';
import { buildKit, card, question, req } from './support/kits';

describe('coverage check', () => {
  const requirements = [req(1), req(2), req(3, 'behavioural'), req(4, 'domain', 'nice')];

  it('reports nothing when every must-have is covered', () => {
    const questions = [question(1, ['r1', 'r2']), question(2, ['r3'])];
    expect(checkCoverage(requirements, questions, 1)).toEqual({
      uncovered_requirement_ids: [],
      passes: 1,
    });
  });

  it('reports one uncovered requirement', () => {
    expect(findUncoveredRequirements(requirements, [question(1, ['r1', 'r3'])])).toEqual(['r2']);
  });

  it('reports several uncovered requirements in requirement order', () => {
    expect(findUncoveredRequirements(requirements, [question(1, ['r2'])])).toEqual(['r1', 'r3']);
  });

  it('never lets nice-to-have requirements block completion', () => {
    const questions = [question(1, ['r1', 'r2', 'r3'])];
    expect(findUncoveredRequirements(requirements, questions)).toEqual([]);
  });

  it('treats a kit with no must-haves as fully covered', () => {
    expect(findUncoveredRequirements([req(1, 'technical', 'nice')], [])).toEqual([]);
  });
});

describe('validateKit', () => {
  const requirements = [req(1), req(2, 'behavioural'), req(3, 'domain', 'nice')];
  const valid = () =>
    toExternalKit(
      buildKit({
        requirements,
        questions: [question(1, ['r1']), question(2, ['r2'], { category: 'behavioural' })],
        flashcards: [card(1, ['r1']), card(2, ['r2'])],
        days: 3,
      }),
    );
  const codes = (kit: unknown) => validateKit(kit).errors.map((e) => e.code);

  it('accepts a consistent kit with no warnings', () => {
    const result = validateKit(valid());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a missing field', () => {
    const kit: Record<string, unknown> = valid();
    delete kit.coverage;
    expect(codes(kit)).toEqual(['SCHEMA']);
  });

  it('rejects an invalid difficulty', () => {
    const kit = valid();
    (kit.questions[0] as { difficulty: number }).difficulty = 5;
    expect(validateKit(kit).errors[0]).toMatchObject({
      code: 'SCHEMA',
      path: 'questions.0.difficulty',
    });
  });

  it('rejects an invalid category', () => {
    const kit = valid() as unknown as { questions: { category: string }[] };
    kit.questions[0]!.category = 'culture';
    expect(validateKit(kit).errors[0]).toMatchObject({
      code: 'SCHEMA',
      path: 'questions.0.category',
    });
  });

  it('rejects a question that references an unknown requirement', () => {
    const kit = valid();
    kit.questions[0]!.requirement_ids = ['r1', 'r99'];
    expect(codes(kit)).toContain('UNKNOWN_REQUIREMENT');
  });

  it('rejects a flashcard that references an unknown requirement', () => {
    const kit = valid();
    kit.flashcards[0]!.requirement_ids = ['r42'];
    expect(codes(kit)).toContain('UNKNOWN_REQUIREMENT');
  });

  it('rejects a schedule that references an unknown question', () => {
    const kit = valid();
    kit.schedule.days[0]!.question_ids.push('q404');
    expect(codes(kit)).toContain('UNKNOWN_QUESTION');
  });

  it('rejects the wrong number of days and bad day numbering', () => {
    const kit = valid();
    kit.schedule.days.pop();
    expect(codes(kit)).toContain('DAY_COUNT');

    const renumbered = valid();
    renumbered.schedule.days[1]!.day = 5;
    expect(codes(renumbered)).toContain('DAY_SEQUENCE');
  });

  it('rejects non-integer minutes', () => {
    const kit = valid();
    kit.schedule.days[0]!.minutes = 30.5;
    expect(codes(kit)).toEqual(['SCHEMA']);
  });

  it('rejects duplicate IDs', () => {
    const kit = valid();
    kit.questions[1]!.id = 'q1';
    expect(codes(kit)).toContain('DUPLICATE_ID');
  });

  it('rejects a coverage field that does not match the questions', () => {
    const kit = valid();
    kit.coverage.uncovered_requirement_ids = ['r2'];
    expect(codes(kit)).toContain('COVERAGE_MISMATCH');
  });

  it('rejects coverage passes beyond the configured maximum', () => {
    const kit = valid();
    kit.coverage.passes = 4;
    expect(validateKit(kit, { maxCoveragePasses: 3 }).errors.map((e) => e.code)).toContain(
      'PASSES_OUT_OF_RANGE',
    );
  });

  it('rejects a covered must-have requirement that is never scheduled', () => {
    const kit = valid();
    for (const day of kit.schedule.days) {
      day.question_ids = day.question_ids.filter((id) => id !== 'q2');
    }
    expect(codes(kit)).toContain('UNSCHEDULED_REQUIREMENT');
  });

  it('exposes uncovered must-haves as a warning, not a silent pass', () => {
    const kit = toExternalKit(
      buildKit({ requirements, questions: [question(1, ['r1'])], flashcards: [card(1, ['r1'])] }),
    );
    const result = validateKit(kit);
    expect(result.valid).toBe(true);
    expect(kit.coverage.uncovered_requirement_ids).toEqual(['r2']);
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['COVERAGE_INCOMPLETE', 'MISSING_FLASHCARD']),
    );
  });
});

describe('toExternalKit', () => {
  it('strips editing metadata so the export matches Appendix A exactly', () => {
    const internal = buildKit({
      requirements: [req(1)],
      questions: [question(1, ['r1'], { state: 'pinned', origin: 'user' })],
      flashcards: [card(1, ['r1'])],
    });
    const external = toExternalKit(internal);
    expect(KitSchema.safeParse(external).success).toBe(true);
    expect(JSON.stringify(external)).not.toMatch(/"state"|"origin"|"counters"/);
    expect(Object.keys(external)).toEqual([
      'source',
      'company_brief',
      'role',
      'questions',
      'flashcards',
      'schedule',
      'coverage',
    ]);
  });
});
