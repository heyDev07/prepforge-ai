import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatedKit, signedInAgent, startHarness, type Harness } from './support/harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

type Kit = Awaited<ReturnType<typeof generatedKit>>;
const ofCategory = (kit: Kit, category: string) =>
  kit.kit.questions.filter((q: { category: string }) => q.category === category);

describe('questions', () => {
  it('adds, edits, pins, moves and deletes questions, keeping coverage and schedule in sync', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const base = `/api/kits/${kit.id}/questions`;

    const added = await agent.post(base).send({
      category: 'behavioural',
      prompt: 'A question I wrote?',
      answer_outline: '- my outline',
      difficulty: 3,
      requirement_ids: ['r1'],
    });
    expect(added.status).toBe(201);
    expect(added.body.question).toMatchObject({
      origin: 'user',
      state: 'edited',
      category: 'behavioural',
    });
    expect(added.body.kit.revision).toBe(kit.revision + 1);
    const scheduled = added.body.kit.kit.schedule.days.flatMap(
      (d: { question_ids: string[] }) => d.question_ids,
    );
    expect(scheduled).toContain(added.body.question.id);

    const target = kit.kit.questions[0].id;
    const edited = await agent.patch(`${base}/${target}`).send({ prompt: 'Rewritten by me?' });
    expect(edited.body.question).toMatchObject({ prompt: 'Rewritten by me?', state: 'edited' });

    const pinned = await agent.patch(`${base}/${target}`).send({ pinned: true });
    expect(pinned.body.question.state).toBe('pinned');

    const moved = await agent.patch(`${base}/${target}`).send({ category: 'company-fit' });
    expect(moved.body.question.category).toBe('company-fit');

    const deleted = await agent.delete(`${base}/${added.body.question.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.kit.kit.questions.map((q: { id: string }) => q.id)).not.toContain(
      added.body.question.id,
    );
  });

  it('reorders one category and rejects anything but an exact permutation', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const ids = ofCategory(kit, 'technical').map((q: { id: string }) => q.id);
    const reversed = [...ids].reverse();

    const ok = await agent
      .post(`/api/kits/${kit.id}/questions/reorder`)
      .send({ category: 'technical', ordered_ids: reversed });
    expect(ok.status).toBe(200);
    expect(ofCategory(ok.body.kit, 'technical').map((q: { id: string }) => q.id)).toEqual(reversed);

    const bad = await agent
      .post(`/api/kits/${kit.id}/questions/reorder`)
      .send({ category: 'technical', ordered_ids: reversed.slice(1) });
    expect(bad.status).toBe(400);
  });

  it('validates question input', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const base = `/api/kits/${kit.id}/questions`;
    const valid = {
      category: 'technical',
      prompt: 'Q?',
      answer_outline: 'A',
      difficulty: 2,
      requirement_ids: ['r1'],
    };

    expect((await agent.post(base).send({ ...valid, difficulty: 4 })).status).toBe(400);
    expect((await agent.post(base).send({ ...valid, category: 'trivia' })).status).toBe(400);
    expect((await agent.post(base).send({ ...valid, requirement_ids: [] })).status).toBe(400);
    const unknown = await agent.post(base).send({ ...valid, requirement_ids: ['r99'] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toMatch(/r99/);
    expect((await agent.patch(`${base}/q9999`).send({ prompt: 'x' })).status).toBe(404);
    expect((await agent.patch(`${base}/${kit.kit.questions[0].id}`).send({})).status).toBe(400);
  });

  it('rejects a stale revision', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const q = kit.kit.questions[0].id;
    await agent
      .patch(`/api/kits/${kit.id}/questions/${q}`)
      .send({ prompt: 'First edit?', revision: kit.revision });
    const stale = await agent
      .patch(`/api/kits/${kit.id}/questions/${q}`)
      .send({ prompt: 'Second edit from an old tab?', revision: kit.revision });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');
  });
});

describe('flashcards, brief and days', () => {
  it('manages flashcards', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const base = `/api/kits/${kit.id}/flashcards`;
    const added = await agent.post(base).send({
      front: 'What is back-pressure?',
      back: 'Slowing producers.',
      requirement_ids: ['r4'],
    });
    expect(added.status).toBe(201);
    expect(added.body.flashcard).toMatchObject({ origin: 'user', state: 'edited' });
    const edited = await agent
      .patch(`${base}/${kit.kit.flashcards[0].id}`)
      .send({ back: 'My better answer.' });
    expect(edited.body.flashcard.state).toBe('edited');
    expect((await agent.delete(`${base}/${added.body.flashcard.id}`)).status).toBe(200);
  });

  it('edits the brief and changes the number of days', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const res = await agent.patch(`/api/kits/${kit.id}`).send({
      company_brief: { summary: 'My own notes about Acme.' },
      days_available: 9,
    });
    expect(res.status).toBe(200);
    expect(res.body.kit.kit.company_brief).toMatchObject({
      summary: 'My own notes about Acme.',
      state: 'edited',
    });
    expect(res.body.kit.kit.schedule.days).toHaveLength(9);
    expect((await agent.patch(`/api/kits/${kit.id}`).send({})).status).toBe(400);
    expect((await agent.patch(`/api/kits/${kit.id}`).send({ days_available: 0 })).status).toBe(400);
  });
});

describe('regeneration', () => {
  it('regenerates one question category and keeps edited, pinned and user-created questions', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const technical = ofCategory(kit, 'technical');
    await agent
      .patch(`/api/kits/${kit.id}/questions/${technical[0].id}`)
      .send({ prompt: 'Keep my wording?' });
    await agent.patch(`/api/kits/${kit.id}/questions/${technical[1].id}`).send({ pinned: true });
    const mine = await agent.post(`/api/kits/${kit.id}/questions`).send({
      category: 'technical',
      prompt: 'My own technical question?',
      answer_outline: '- notes',
      difficulty: 2,
      requirement_ids: ['r2'],
    });
    const before = (await agent.get(`/api/kits/${kit.id}`)).body.kit;

    const started = await agent.post(`/api/kits/${kit.id}/regenerate/questions/technical`);
    expect(started.status).toBe(202);
    await h.jobs.idle();
    const status = await agent.get(`/api/kits/${kit.id}/generation-status`);
    expect(status.body.job).toMatchObject({
      type: 'regenerate_questions',
      status: 'completed',
      category: 'technical',
    });

    const after = (await agent.get(`/api/kits/${kit.id}`)).body.kit;
    const ids = after.kit.questions.map((q: { id: string }) => q.id);
    expect(ids).toEqual(
      expect.arrayContaining([technical[0].id, technical[1].id, mine.body.question.id]),
    );
    for (const q of technical.slice(2)) expect(ids).not.toContain(q.id);
    expect(after.kit.questions.find((q: { id: string }) => q.id === technical[0].id).prompt).toBe(
      'Keep my wording?',
    );
    for (const category of ['behavioural', 'system-design', 'company-fit']) {
      expect(ofCategory(after, category)).toEqual(ofCategory(before, category));
    }
    expect(after.kit.flashcards).toEqual(before.kit.flashcards);
    expect(after.kit.company_brief).toEqual(before.kit.company_brief);
  });

  it('protects an edited or pinned company brief', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    await agent.patch(`/api/kits/${kit.id}`).send({ company_brief: { summary: 'Mine.' } });

    const needsConfirmation = await agent.post(`/api/kits/${kit.id}/regenerate/company`).send({});
    expect(needsConfirmation.status).toBe(409);
    expect(needsConfirmation.body.error.code).toBe('CONFIRMATION_REQUIRED');

    await agent.patch(`/api/kits/${kit.id}`).send({ company_brief: { pinned: true } });
    const pinned = await agent.post(`/api/kits/${kit.id}/regenerate/company`).send({ force: true });
    expect(pinned.status).toBe(409);
    expect(pinned.body.error.code).toBe('CONFLICT');

    await agent.patch(`/api/kits/${kit.id}`).send({ company_brief: { pinned: false } });
    const forced = await agent.post(`/api/kits/${kit.id}/regenerate/company`).send({ force: true });
    expect(forced.status).toBe(202);
    await h.jobs.idle();
    const after = (await agent.get(`/api/kits/${kit.id}`)).body.kit;
    expect(after.kit.company_brief.state).toBe('generated');
    expect(after.kit.company_brief.summary).not.toBe('Mine.');
    expect(after.kit.questions).toEqual(kit.kit.questions);
  });

  it('rebuilds the schedule synchronously and rejects unknown categories', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const res = await agent.post(`/api/kits/${kit.id}/regenerate/schedule`);
    expect(res.status).toBe(200);
    expect(res.body.kit.kit.schedule.days).toHaveLength(kit.kit.schedule.days.length);
    expect((await agent.post(`/api/kits/${kit.id}/regenerate/questions/trivia`)).status).toBe(400);
  });

  it('refuses edits before the kit is generated', async () => {
    const agent = await signedInAgent(h.app);
    const created = await agent.post('/api/kits').send({
      jd: 'Backend developer. You should know Python and SQL.',
      company_url: h.sites.urls['no-careers'],
      days: 2,
    });
    const res = await agent.post(`/api/kits/${created.body.kit.id}/regenerate/schedule`);
    expect(res.status).toBe(409);
  });
});
