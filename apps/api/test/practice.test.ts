import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatedKit, signedInAgent, startHarness, type Harness } from './support/harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe('practice', () => {
  it('validates confidence and the flashcard', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const card = kit.kit.flashcards[0].id;
    for (const confidence of [0, 6, 2.5, '3']) {
      const res = await agent.post(`/api/kits/${kit.id}/practice/${card}`).send({ confidence });
      expect(res.status).toBe(400);
    }
    expect(
      (await agent.post(`/api/kits/${kit.id}/practice/f999`).send({ confidence: 3 })).status,
    ).toBe(404);
  });

  it('records confidence and serves the weakest card next', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    type Card = { id: string; requirement_ids: string[] };
    const cards: Card[] = kit.kit.flashcards;
    // every card of one requirement is rated low; all others high
    const weakRequirement = cards[2]!.requirement_ids[0]!;
    const isWeak = (card: Card) => card.requirement_ids.includes(weakRequirement);
    const weakCards = cards.filter(isWeak).map((c) => c.id);
    const strong = cards.find((c) => !isWeak(c))!;

    for (const card of cards) {
      const res = await agent
        .post(`/api/kits/${kit.id}/practice/${card.id}`)
        .send({ confidence: isWeak(card) ? 1 : 5 });
      expect(res.status).toBe(201);
    }
    const recorded = await agent
      .post(`/api/kits/${kit.id}/practice/${strong.id}`)
      .send({ confidence: 3 });
    expect(recorded.body.stats).toMatchObject({
      flashcard_id: strong.id,
      attempts: 2,
      last_confidence: 3,
      confidence: 4,
    });

    const next = await agent.get(`/api/kits/${kit.id}/practice/next`);
    expect(next.body).toMatchObject({ mode: 'all', remaining: cards.length });
    expect(weakCards).toContain(next.body.flashcard.id);

    // a round shows each card once, then ends
    const answered: string[] = [];
    let current = next.body;
    while (current.flashcard) {
      expect(answered).not.toContain(current.flashcard.id);
      expect(current.remaining).toBe(cards.length - answered.length);
      answered.push(current.flashcard.id);
      current = (
        await agent.get(`/api/kits/${kit.id}/practice/next?answered=${answered.join(',')}`)
      ).body;
    }
    expect(current).toMatchObject({ flashcard: null, remaining: 0 });
    expect(answered).toHaveLength(cards.length);

    // the next round does not open with the card answered last
    const newRound = await agent.get(`/api/kits/${kit.id}/practice/next?last=${answered.at(-1)}`);
    expect(newRound.body.flashcard.id).not.toBe(answered.at(-1));

    const weak = await agent.get(`/api/kits/${kit.id}/practice/next?mode=weak`);
    expect(weak.body.mode).toBe('weak');
    expect(weakCards).toContain(weak.body.flashcard.id);
    expect(weak.body.remaining).toBeLessThan(cards.length);

    expect((await agent.get(`/api/kits/${kit.id}/practice/next?mode=bogus`)).status).toBe(400);
  });

  it('computes Weak Spots from the user’s own practice only', async () => {
    const owner = await signedInAgent(h.app);
    const kit = await generatedKit(h, owner);
    const card = kit.kit.flashcards[0];

    const before = await owner.get(`/api/kits/${kit.id}/weak-spots`);
    expect(before.body.weak_spots).toMatchObject({ readiness: 0, practiced_flashcards: 0 });

    await owner.post(`/api/kits/${kit.id}/practice/${card.id}`).send({ confidence: 1 });
    const after = (await owner.get(`/api/kits/${kit.id}/weak-spots`)).body.weak_spots;
    expect(after.practiced_flashcards).toBe(1);
    const requirement = after.requirements.find(
      (r: { id: string }) => r.id === card.requirement_ids[0],
    );
    expect(requirement).toMatchObject({ confidence: 1, weak: true });
    expect(requirement.reasons).toContain('low_confidence');
    expect(after.weak_requirement_ids).toContain(card.requirement_ids[0]);
  });
});
