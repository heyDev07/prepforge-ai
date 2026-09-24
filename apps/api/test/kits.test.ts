import { KitSchema, PIPELINE_STAGE_SEQUENCE } from '@prepforge/shared';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fixtureJd,
  generatedKit,
  signedInAgent,
  startHarness,
  type Harness,
} from './support/harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const input = () => ({
  jd: fixtureJd('jd-frontend.txt'),
  company_url: h.sites.urls['relative-links'],
  days: 3,
});

describe('creating kits', () => {
  it('requires authentication', async () => {
    expect((await supertest(h.app).get('/api/kits')).status).toBe(401);
    expect((await supertest(h.app).post('/api/kits').send(input())).status).toBe(401);
  });

  it.each([
    [{ days: 0 }, 'days'],
    [{ days: 61 }, 'days'],
    [{ jd: 'too short' }, 'jd'],
    [{ company_url: 'not a url' }, 'company_url'],
  ])('rejects invalid input %o', async (override, field) => {
    const agent = await signedInAgent(h.app);
    const res = await agent.post('/api/kits').send({ ...input(), ...override });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
    expect(res.body.error.message).toContain(field);
  });

  it('creates a draft kit and detects duplicates per user', async () => {
    const agent = await signedInAgent(h.app);
    const created = await agent.post('/api/kits').send(input());
    expect(created.status).toBe(201);
    expect(created.body.kit).toMatchObject({ status: 'draft', kit: null, revision: 0 });

    const duplicate = await agent.post('/api/kits').send({ ...input(), jd: `  ${input().jd}  ` });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_KIT');
    expect(duplicate.body.error.details.existing_kit_id).toBe(created.body.kit.id);

    expect((await agent.post('/api/kits').send({ ...input(), allow_duplicate: true })).status).toBe(
      201,
    );

    // another user submitting the same input is not a duplicate — kits are never shared
    const other = await signedInAgent(h.app);
    expect((await other.post('/api/kits').send(input())).status).toBe(201);
  });

  it('lists only the signed-in user’s kits, newest first', async () => {
    const alice = await signedInAgent(h.app);
    const bob = await signedInAgent(h.app);
    await alice.post('/api/kits').send(input());
    await alice.post('/api/kits').send({ ...input(), days: 7, allow_duplicate: true });
    await bob.post('/api/kits').send(input());

    const list = await alice.get('/api/kits');
    expect(list.body.kits).toHaveLength(2);
    expect(list.body.kits[0]).toMatchObject({ days: 7, status: 'draft', latest_job: null });
    expect(list.body.kits[0].company).toBe('localhost');
  });
});

describe('generation jobs', () => {
  it('runs the pipeline as a job and records every stage', async () => {
    const agent = await signedInAgent(h.app);
    const created = await agent.post('/api/kits').send(input());
    const id = created.body.kit.id;

    const started = await agent.post(`/api/kits/${id}/generate`);
    expect(started.status).toBe(202);
    expect(started.body.job).toMatchObject({ type: 'generate', kit_id: id });
    expect(['queued', 'running']).toContain(started.body.job.status);

    await h.jobs.idle();
    const status = await agent.get(`/api/kits/${id}/generation-status`);
    expect(status.body.kit_status).toBe('ready');
    expect(status.body.job).toMatchObject({ status: 'completed', progress: 100, error: null });
    const stages = status.body.job.stage_log.map((entry: { stage: string }) => entry.stage);
    expect(stages).toEqual([...PIPELINE_STAGE_SEQUENCE]);
    expect(status.body.job.stage_log.every((e: { status: string }) => e.status !== 'running')).toBe(
      true,
    );

    const kit = (await agent.get(`/api/kits/${id}`)).body.kit;
    expect(kit.status).toBe('ready');
    expect(kit.kit.schedule.days).toHaveLength(3);
    expect(kit.research.pages.length).toBeGreaterThan(1);
    expect(kit.latest_job.status).toBe('completed');
  });

  it('refuses a full regeneration of a generated kit', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const again = await agent.post(`/api/kits/${kit.id}/generate`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
  });

  it('marks the job and kit as failed with a structured error, and allows a retry', async () => {
    const agent = await signedInAgent(h.app);
    const created = await agent
      .post('/api/kits')
      .send({ ...input(), company_url: 'http://localhost:1' });
    const id = created.body.kit.id;
    await agent.post(`/api/kits/${id}/generate`);
    await h.jobs.idle();

    const status = await agent.get(`/api/kits/${id}/generation-status`);
    expect(status.body.kit_status).toBe('failed');
    expect(status.body.job.status).toBe('failed');
    expect(status.body.job.error).toMatchObject({
      code: 'COMPANY_UNREACHABLE',
      stage: 'researching_company',
      retryable: true,
    });
    expect(status.body.job.stage_log.at(-1)).toMatchObject({
      stage: 'researching_company',
      status: 'failed',
    });

    const retry = await agent.post(`/api/kits/${id}/generate`);
    expect(retry.status).toBe(202);
    await h.jobs.idle();
  });

  it('exports the exact Appendix A kit', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    const res = await agent.get(`/api/kits/${kit.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(KitSchema.safeParse(res.body).success).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/"state"|"origin"|"counters"/);
  });
});

describe('ownership', () => {
  it('returns 404 for every route on another user’s kit', async () => {
    const owner = await signedInAgent(h.app);
    const kit = await generatedKit(h, owner);
    const intruder = await signedInAgent(h.app);
    const q = kit.kit.questions[0].id;
    const f = kit.kit.flashcards[0].id;

    const attempts = [
      intruder.get(`/api/kits/${kit.id}`),
      intruder.patch(`/api/kits/${kit.id}`).send({ days_available: 2 }),
      intruder.delete(`/api/kits/${kit.id}`),
      intruder.get(`/api/kits/${kit.id}/export`),
      intruder.post(`/api/kits/${kit.id}/generate`),
      intruder.get(`/api/kits/${kit.id}/generation-status`),
      intruder.post(`/api/kits/${kit.id}/regenerate/questions/technical`),
      intruder.post(`/api/kits/${kit.id}/regenerate/schedule`),
      intruder.patch(`/api/kits/${kit.id}/questions/${q}`).send({ prompt: 'hijack?' }),
      intruder.delete(`/api/kits/${kit.id}/flashcards/${f}`),
      intruder.post(`/api/kits/${kit.id}/practice/${f}`).send({ confidence: 5 }),
      intruder.get(`/api/kits/${kit.id}/weak-spots`),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await intruder.get('/api/kits')).body.kits).toEqual([]);
    // the owner's kit is untouched
    expect((await owner.get(`/api/kits/${kit.id}`)).body.kit.revision).toBe(kit.revision);
  });

  it('treats malformed IDs as not found', async () => {
    const agent = await signedInAgent(h.app);
    expect((await agent.get('/api/kits/not-an-id')).status).toBe(404);
  });

  it('deletes a kit with its jobs', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    expect((await agent.delete(`/api/kits/${kit.id}`)).status).toBe(204);
    expect((await agent.get(`/api/kits/${kit.id}`)).status).toBe(404);
  });
});
