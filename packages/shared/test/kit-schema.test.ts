import { describe, expect, it } from 'vitest';
import { KitSchema } from '../src';
import { makeValidKit } from './fixtures';

function issuesFor(value: unknown): string[] {
  const result = KitSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('KitSchema (Appendix A)', () => {
  it('accepts a valid kit', () => {
    expect(KitSchema.safeParse(makeValidKit()).success).toBe(true);
  });

  it('accepts localhost company URLs used by the batch evaluator', () => {
    const kit = makeValidKit();
    kit.source.company_url = 'http://localhost:4010/';
    expect(KitSchema.safeParse(kit).success).toBe(true);
  });

  it.each([
    ['source'],
    ['company_brief'],
    ['role'],
    ['questions'],
    ['flashcards'],
    ['schedule'],
    ['coverage'],
  ])('rejects a kit missing top-level field "%s"', (field) => {
    const kit: Record<string, unknown> = makeValidKit();
    delete kit[field];
    expect(issuesFor(kit)).toContain(field);
  });

  it('rejects a missing nested field', () => {
    const kit = makeValidKit() as unknown as { source: Record<string, unknown> };
    delete kit.source.jd_chars;
    expect(issuesFor(kit)).toContain('source.jd_chars');
  });

  it('rejects unknown extra fields so the export matches the spec exactly', () => {
    const kit = makeValidKit();
    (kit.questions[0] as unknown as Record<string, unknown>).state = 'edited';
    expect(KitSchema.safeParse(kit).success).toBe(false);
  });

  it.each([0, 4, 2.5, '2'])('rejects difficulty %s', (difficulty) => {
    const kit = makeValidKit();
    (kit.questions[0] as unknown as Record<string, unknown>).difficulty = difficulty;
    expect(issuesFor(kit)).toContain('questions.0.difficulty');
  });

  it('rejects an unknown question category', () => {
    const kit = makeValidKit();
    (kit.questions[0] as unknown as Record<string, unknown>).category = 'trivia';
    expect(issuesFor(kit)).toContain('questions.0.category');
  });

  it('rejects an unknown requirement kind and priority', () => {
    const kit = makeValidKit();
    const req = kit.role.requirements[0] as unknown as Record<string, unknown>;
    req.kind = 'soft-skill';
    req.priority = 'should';
    expect(issuesFor(kit)).toEqual(
      expect.arrayContaining(['role.requirements.0.kind', 'role.requirements.0.priority']),
    );
  });

  it('rejects non-integer minutes', () => {
    const kit = makeValidKit();
    kit.schedule.days[0]!.minutes = 12.5;
    expect(issuesFor(kit)).toContain('schedule.days.0.minutes');
  });

  it('rejects malformed IDs', () => {
    const kit = makeValidKit();
    kit.questions[0]!.id = 'question-1';
    kit.role.requirements[0]!.id = 'R1';
    expect(issuesFor(kit)).toEqual(
      expect.arrayContaining(['questions.0.id', 'role.requirements.0.id']),
    );
  });

  it('rejects a question that references no requirement', () => {
    const kit = makeValidKit();
    kit.questions[0]!.requirement_ids = [];
    expect(issuesFor(kit)).toContain('questions.0.requirement_ids');
  });

  it('rejects an empty prompt', () => {
    const kit = makeValidKit();
    kit.questions[0]!.prompt = '   ';
    expect(issuesFor(kit)).toContain('questions.0.prompt');
  });

  it('rejects a non-ISO researched_at timestamp', () => {
    const kit = makeValidKit();
    kit.source.researched_at = 'yesterday';
    expect(issuesFor(kit)).toContain('source.researched_at');
  });

  it('rejects coverage passes below 1', () => {
    const kit = makeValidKit();
    kit.coverage.passes = 0;
    expect(issuesFor(kit)).toContain('coverage.passes');
  });
});
