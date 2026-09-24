import type { PracticeAttemptRecord } from '@prepforge/shared';
import { describe, expect, it } from 'vitest';
import { computeCardStats, computeWeakSpots, orderPracticeQueue } from '../src/practice/practice';
import { buildKit, card, question, req } from './support/kits';

const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 10, minute)).toISOString();
const attempt = (id: string, confidence: number, minute: number): PracticeAttemptRecord => ({
  flashcard_id: id,
  confidence,
  created_at: at(minute),
});

function kit() {
  return buildKit({
    requirements: [req(1), req(2), req(3, 'behavioural'), req(4, 'domain', 'nice')],
    questions: [
      question(1, ['r1']),
      question(2, ['r2'], { category: 'system-design' }),
      question(3, ['r4'], { category: 'company-fit' }),
      // r3 (must) has no question → uncovered
    ],
    flashcards: [card(1, ['r1']), card(2, ['r2']), card(3, ['r4'])],
  });
}

describe('computeCardStats', () => {
  it('computes an exponentially weighted confidence in time order', () => {
    const stats = computeCardStats(kit().flashcards, [
      attempt('f1', 5, 2),
      attempt('f1', 1, 1), // older, listed out of order
      attempt('f1', 4, 3),
      attempt('f9', 5, 4), // deleted card: ignored
    ]);
    // 1 → 0.5·5 + 0.5·1 = 3 → 0.5·4 + 0.5·3 = 3.5
    expect(stats.get('f1')).toMatchObject({ attempts: 3, last_confidence: 4, confidence: 3.5 });
    expect(stats.get('f2')).toMatchObject({ attempts: 0, confidence: null });
  });
});

describe('orderPracticeQueue', () => {
  const now = new Date(at(10));

  it('puts the weakest cards first, unseen cards before confident ones', () => {
    const queue = orderPracticeQueue(kit(), [attempt('f1', 5, 5), attempt('f2', 1, 5)], { now });
    expect(queue.map((e) => e.flashcard.id)).toEqual(['f2', 'f3', 'f1']);
  });

  it('does not start with the card that was just answered', () => {
    const queue = orderPracticeQueue(kit(), [attempt('f2', 1, 5)], { now, lastId: 'f2' });
    expect(queue[0]!.flashcard.id).not.toBe('f2');
    expect(queue.map((e) => e.flashcard.id)).toContain('f2');
  });

  it('shows each card once per round and then ends the round', () => {
    const attempts = [attempt('f2', 1, 5)]; // f2 stays the weakest card; f1 supports a must-have
    expect(
      orderPracticeQueue(kit(), attempts, { now, answered: ['f2'] }).map((e) => e.flashcard.id),
    ).toEqual(['f1', 'f3']);
    expect(orderPracticeQueue(kit(), attempts, { now, answered: ['f1', 'f2', 'f3'] })).toEqual([]);
  });

  it('limits weak mode to cards for weak requirements', () => {
    const queue = orderPracticeQueue(
      kit(),
      [attempt('f1', 5, 1), attempt('f2', 2, 2), attempt('f3', 5, 3)],
      { mode: 'weak', now },
    );
    expect(queue.map((e) => e.flashcard.id)).toEqual(['f2']);
  });

  it('is deterministic', () => {
    const attempts = [attempt('f1', 3, 1), attempt('f3', 3, 1)];
    expect(orderPracticeQueue(kit(), attempts, { now })).toEqual(
      orderPracticeQueue(kit(), attempts, { now }),
    );
  });
});

describe('computeWeakSpots', () => {
  it('reports readiness, weak requirements and weakest categories', () => {
    const report = computeWeakSpots(kit(), [
      attempt('f1', 5, 1), // r1 → 5
      attempt('f2', 2, 2), // r2 → 2 (low)
      attempt('f3', 4, 3), // r4 → 4
    ]);
    const byId = Object.fromEntries(report.requirements.map((r) => [r.id, r]));
    expect(byId.r1).toMatchObject({ confidence: 5, weak: false, reasons: [] });
    expect(byId.r2).toMatchObject({ confidence: 2, weak: true, reasons: ['low_confidence'] });
    expect(byId.r3).toMatchObject({ confidence: null, reasons: ['uncovered', 'no_flashcard'] });
    expect(report.weak_requirement_ids).toEqual(['r2', 'r3']);
    // (2·1 + 2·0.25 + 2·0 + 1·0.75) / 7 = 0.464…
    expect(report.readiness).toBe(46);
    expect(report.counts).toEqual({ uncovered: 1, low_confidence: 1, unpracticed: 0 });
    expect(report.weakest_categories).toEqual(['system-design']);
    expect(report.categories.find((c) => c.category === 'behavioural')).toEqual({
      category: 'behavioural',
      confidence: null,
      questions: 0,
    });
  });

  it('flags any requirement without a flashcard, since it holds readiness down', () => {
    const noNiceCard = buildKit({
      requirements: [req(1), req(2, 'domain', 'nice')],
      questions: [question(1, ['r1']), question(2, ['r2'])],
      flashcards: [card(1, ['r1'])],
    });
    const report = computeWeakSpots(noNiceCard, [attempt('f1', 5, 1)]);
    expect(report.requirements[1]).toMatchObject({ weak: true, reasons: ['no_flashcard'] });
    // everything practisable is at 5/5, yet readiness is capped: (2·1 + 1·0) / 3
    expect(report.readiness).toBe(67);
  });

  it('starts at zero readiness before any practice', () => {
    const report = computeWeakSpots(kit(), []);
    expect(report.readiness).toBe(0);
    expect(report.counts.unpracticed).toBe(3);
  });
});
