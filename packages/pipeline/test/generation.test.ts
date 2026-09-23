import { describe, expect, it } from 'vitest';
import { runCoverageLoop } from '../src/coverage/coverage-loop';
import { flashcardCount } from '../src/generation/flashcards';
import { planQuestions, systemDesignCount } from '../src/generation/question-plan';
import { sanitizeQuestions, sanitizeRequirementIds } from '../src/generation/sanitize';
import { buildKit, question, req } from './support/kits';

describe('planQuestions (code decides counts)', () => {
  const requirements = [
    req(1),
    req(2),
    req(3, 'domain', 'nice'),
    req(4, 'behavioural'),
    req(5, 'behavioural', 'nice'),
  ];

  it('sizes each category from the requirements', () => {
    const plans = planQuestions(requirements, 'Senior', { researchIsThin: false });
    expect(plans.map((p) => [p.category, p.count])).toEqual([
      ['technical', 5], // 2·2 must + 1 nice
      ['behavioural', 4], // 2·2
      ['system-design', 3], // senior
      ['company-fit', 3],
    ]);
    expect(plans[0]!.requirementIds).toEqual(['r1', 'r2', 'r3']);
    expect(plans[0]!.mustIds).toEqual(['r1', 'r2']);
  });

  it('skips technical and system-design questions when the JD has no technical requirements', () => {
    const plans = planQuestions([req(1, 'behavioural')], 'Not specified', { researchIsThin: true });
    expect(plans.map((p) => p.count)).toEqual([0, 3, 0, 2]);
  });

  it('lets behavioural questions use any requirement when none are behavioural', () => {
    const plans = planQuestions([req(1), req(2)], 'Not specified', { researchIsThin: false });
    expect(plans[1]).toMatchObject({ count: 2, requirementIds: ['r1', 'r2'] });
  });

  it.each([
    ['Junior', 1],
    ['Graduate engineer', 1],
    ['Not specified', 2],
    ['Senior', 3],
    ['Staff', 3],
  ])('system design count for "%s" is %i', (seniority, count) => {
    expect(systemDesignCount(seniority)).toBe(count);
  });

  it('sizes flashcards at about 1.5 per requirement, between 4 and 20', () => {
    expect([1, 5, 30].map(flashcardCount)).toEqual([4, 8, 20]);
  });
});

describe('sanitising generated references', () => {
  const requirements = [req(1), req(2, 'behavioural'), req(3, 'domain')];
  const rules = { requirements, allowedKinds: ['technical', 'domain'] as const, maxLinks: 2 };

  it('normalises IDs and drops unknown or kind-incompatible ones', () => {
    expect(sanitizeRequirementIds([' R1 ', 'r2', 'r9', 'r3', 'r1'], rules)).toEqual(['r1', 'r3']);
  });

  it('requires a gap-fill target when one is set', () => {
    expect(
      sanitizeRequirementIds(['r1'], { ...rules, mustReferenceOneOf: new Set(['r3']) }),
    ).toEqual([]);
  });

  it('drops questions without valid links, duplicates and clamps difficulty', () => {
    const result = sanitizeQuestions(
      [
        {
          prompt: 'Explain indexing?',
          answer_outline: '- B-trees',
          difficulty: 7,
          requirement_ids: ['r1'],
        },
        {
          prompt: 'Tell me about a time?',
          answer_outline: '- STAR',
          difficulty: 2,
          requirement_ids: ['r2'],
        },
        {
          prompt: 'explain  INDEXING?',
          answer_outline: '- again',
          difficulty: 1,
          requirement_ids: ['r1'],
        },
        { prompt: 'Existing one', answer_outline: '- x', difficulty: 2, requirement_ids: ['r1'] },
        {
          prompt: 'Domain question?',
          answer_outline: '- y',
          difficulty: 0.4,
          requirement_ids: ['r3'],
        },
      ],
      { ...rules, category: 'technical', existingPrompts: ['Existing one'], limit: 10 },
    );
    expect(result.map((q) => [q.prompt, q.difficulty, q.requirement_ids])).toEqual([
      ['Explain indexing?', 3, ['r1']],
      ['Domain question?', 1, ['r3']],
    ]);
  });
});

describe('runCoverageLoop', () => {
  const requirements = [req(1), req(2), req(3)];

  it('does not generate anything when coverage is already complete', async () => {
    const kit = buildKit({ requirements, questions: [question(1, ['r1', 'r2', 'r3'])] });
    let calls = 0;
    const result = await runCoverageLoop(kit, {
      maxPasses: 3,
      generate: async () => {
        calls++;
        return [];
      },
    });
    expect(calls).toBe(0);
    expect(result.passes).toBe(1);
  });

  const gapFill = (asked: string[][]) => async (uncovered: string[]) => {
    asked.push(uncovered);
    return [
      {
        category: 'technical' as const,
        prompt: `Gap question for ${uncovered[0]}?`,
        answer_outline: '- x',
        difficulty: 2 as const,
        requirement_ids: [uncovered[0]!],
      },
    ];
  };

  it('asks only for uncovered IDs and checks again after each pass', async () => {
    const kit = buildKit({ requirements, questions: [question(1, ['r1'])] });
    const asked: string[][] = [];
    const result = await runCoverageLoop(kit, { maxPasses: 3, generate: gapFill(asked) });
    expect(asked).toEqual([['r2', 'r3'], ['r3']]);
    expect(result.kit.coverage).toEqual({ uncovered_requirement_ids: [], passes: 3 });
    expect(result.added).toBe(2);
  });

  it('stops at the pass limit and keeps the remaining gaps visible', async () => {
    const kit = buildKit({ requirements, questions: [question(1, ['r1'])] });
    const asked: string[][] = [];
    const result = await runCoverageLoop(kit, { maxPasses: 2, generate: gapFill(asked) });
    expect(asked).toEqual([['r2', 'r3']]);
    expect(result.kit.coverage).toEqual({ uncovered_requirement_ids: ['r3'], passes: 2 });
  });
});
