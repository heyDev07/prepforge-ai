import type { Question, Requirement } from '@prepforge/shared';
import { describe, expect, it } from 'vitest';
import { allocateSchedule, MAX_DAY_MINUTES } from '../src/schedule/allocate';
import { MOCK_INTERVIEW_FOCUS } from '../src/schedule/focus';
import { byPriority, scoreQuestions } from '../src/schedule/score';
import { question, req } from './support/kits';

/** Small seeded PRNG so "random" kits are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = ['technical', 'behavioural', 'system-design', 'company-fit'] as const;

function randomKit(seed: number) {
  const rand = mulberry32(seed);
  const requirementCount = 1 + Math.floor(rand() * 15);
  const requirements: Requirement[] = Array.from({ length: requirementCount }, (_, i) =>
    req(
      i + 1,
      rand() < 0.6 ? 'technical' : rand() < 0.5 ? 'behavioural' : 'domain',
      rand() < 0.75 ? 'must' : 'nice',
    ),
  );
  const questionCount = Math.floor(rand() * 30);
  const questions: Question[] = Array.from({ length: questionCount }, (_, i) => {
    const ids = new Set<string>();
    const links = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < links; k++) ids.add(`r${1 + Math.floor(rand() * requirementCount)}`);
    return question(i + 1, [...ids], {
      category: CATEGORIES[Math.floor(rand() * 4)]!,
      difficulty: (1 + Math.floor(rand() * 3)) as 1 | 2 | 3,
    });
  });
  return { requirements, questions };
}

function scheduledRequirements(
  schedule: ReturnType<typeof allocateSchedule>,
  questions: Question[],
) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return new Set(
    schedule.days.flatMap((d) => d.question_ids.flatMap((id) => byId.get(id)!.requirement_ids)),
  );
}

function coveredMust(requirements: Requirement[], questions: Question[]) {
  const referenced = new Set(questions.flatMap((q) => q.requirement_ids));
  return requirements.filter((r) => r.priority === 'must' && referenced.has(r.id)).map((r) => r.id);
}

function assertInvariants(days: number, requirements: Requirement[], questions: Question[]) {
  const schedule = allocateSchedule({
    daysAvailable: days,
    requirements,
    questions,
    flashcardCount: 3,
  });
  const ids = new Set(questions.map((q) => q.id));
  expect(schedule.days_available).toBe(days);
  expect(schedule.days).toHaveLength(days);
  schedule.days.forEach((day, i) => {
    expect(day.day).toBe(i + 1);
    expect(Number.isInteger(day.minutes)).toBe(true);
    expect(day.minutes).toBeGreaterThan(0);
    expect(day.focus.length).toBeGreaterThan(0);
    expect(new Set(day.question_ids).size).toBe(day.question_ids.length);
    for (const id of day.question_ids) expect(ids.has(id)).toBe(true);
  });
  const scheduled = scheduledRequirements(schedule, questions);
  for (const id of coveredMust(requirements, questions)) expect(scheduled.has(id)).toBe(true);
  return schedule;
}

describe('scoreQuestions', () => {
  it('applies the documented weights', () => {
    const requirements = [req(1), req(2, 'behavioural', 'nice')];
    const questions = [
      question(1, ['r1'], { difficulty: 3 }), // 3 (diff) + 3 (must) + 1 (technical) + 2 (sole) = 9
      question(2, ['r2'], { category: 'behavioural', difficulty: 1 }), // 1
    ];
    const scores = scoreQuestions(requirements, questions, new Set(['r2']));
    expect(scores.map((s) => s.score)).toEqual([9, 3]);
    expect(scores.map((s) => s.minutes)).toEqual([25, 10]);
  });

  it('orders by score and keeps the original order on ties', () => {
    const requirements = [req(1)];
    const questions = [
      question(1, ['r1']),
      question(2, ['r1']),
      question(3, ['r1'], { difficulty: 3 }),
    ];
    const order = scoreQuestions(requirements, questions)
      .sort(byPriority)
      .map((s) => s.question.id);
    expect(order).toEqual(['q3', 'q1', 'q2']);
  });
});

describe('allocateSchedule', () => {
  const requirements = [req(1), req(2), req(3, 'behavioural'), req(4, 'domain', 'nice')];
  const questions = [
    question(1, ['r4'], { category: 'company-fit', difficulty: 1 }),
    question(2, ['r1'], { difficulty: 3 }),
    question(3, ['r3'], { category: 'behavioural', difficulty: 2 }),
    question(4, ['r2'], { category: 'system-design', difficulty: 3 }),
    question(5, ['r1', 'r2'], { difficulty: 2 }),
    question(6, ['r3'], { category: 'behavioural', difficulty: 1 }),
  ];

  it.each([1, 2, 5, 60])('produces exactly %i valid day(s) covering every must-have', (days) => {
    assertInvariants(days, requirements, questions);
  });

  it('schedules high-priority material earlier', () => {
    const schedule = allocateSchedule({ daysAvailable: 5, requirements, questions });
    const scores = new Map(
      scoreQuestions(requirements, questions).map((s) => [s.question.id, s.score]),
    );
    const learnDays = schedule.days.filter(
      (d) => !d.focus.startsWith('Review') && d.focus !== MOCK_INTERVIEW_FOCUS,
    );
    const averages = learnDays.map(
      (d) => d.question_ids.reduce((sum, id) => sum + scores.get(id)!, 0) / d.question_ids.length,
    );
    for (let i = 1; i < averages.length; i++) {
      expect(averages[i]!).toBeLessThanOrEqual(averages[i - 1]!);
    }
    expect(schedule.days[0]!.question_ids[0]).toBe('q2');
  });

  it('puts every question in a learning day when there is enough time', () => {
    const schedule = allocateSchedule({ daysAvailable: 5, requirements, questions });
    const learned = schedule.days.filter(
      (d) => !d.focus.startsWith('Review') && d.focus !== MOCK_INTERVIEW_FOCUS,
    );
    expect(learned.flatMap((d) => d.question_ids).sort()).toEqual(
      questions.map((q) => q.id).sort(),
    );
  });

  it('ends a multi-day plan with a mock interview drawing on every category', () => {
    const schedule = allocateSchedule({ daysAvailable: 5, requirements, questions });
    const last = schedule.days.at(-1)!;
    expect(last.focus).toBe(MOCK_INTERVIEW_FOCUS);
    const categories = new Set(
      last.question_ids.map((id) => questions.find((q) => q.id === id)!.category),
    );
    expect(categories.size).toBe(4);
  });

  it('compresses a 1-day plan but still covers every must-have requirement', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      question(i + 1, [`r${(i % 3) + 1}`], { difficulty: 3 }),
    );
    const schedule = assertInvariants(1, requirements, many);
    expect(schedule.days[0]!.minutes).toBeLessThanOrEqual(MAX_DAY_MINUTES + 10);
    expect(schedule.days[0]!.question_ids.length).toBeLessThan(40);
  });

  it('spreads a 60-day plan without empty days', () => {
    const schedule = assertInvariants(60, requirements, questions);
    expect(schedule.days.every((d) => d.question_ids.length > 0)).toBe(true);
  });

  it('still returns N days when there are no questions', () => {
    const schedule = allocateSchedule({ daysAvailable: 3, requirements, questions: [] });
    expect(schedule.days).toHaveLength(3);
    expect(schedule.days.every((d) => d.question_ids.length === 0 && d.minutes === 30)).toBe(true);
  });

  it('prioritises weak requirements when practice data exists', () => {
    const plain = allocateSchedule({ daysAvailable: 3, requirements, questions });
    const weak = allocateSchedule({
      daysAvailable: 3,
      requirements,
      questions,
      weakRequirementIds: new Set(['r3']),
    });
    const position = (s: typeof plain) => s.days.flatMap((d) => d.question_ids).indexOf('q3');
    expect(position(weak)).toBeLessThan(position(plain));
  });

  it('is deterministic', () => {
    const a = allocateSchedule({ daysAvailable: 7, requirements, questions });
    const b = allocateSchedule({ daysAvailable: 7, requirements, questions });
    expect(a).toEqual(b);
  });

  it('holds its invariants for 200 random kits and day counts', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const kit = randomKit(seed);
      const days = 1 + ((seed * 7) % 60);
      assertInvariants(days, kit.requirements, kit.questions);
    }
  });
});
