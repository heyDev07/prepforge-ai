import { MockLlmProvider } from '@prepforge/pipeline';
import { fixtureLlmResponder } from '@prepforge/pipeline/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenerationJobModel, Kit } from '../src/models';
import {
  fixtureJd,
  generatedKit,
  signedInAgent,
  startHarness,
  type Harness,
} from './support/harness';

/** The fixture model, except that extraction waits until the test opens the gate. */
let gate: Promise<void> = Promise.resolve();
let openGate = () => {};
const closeGate = () => {
  gate = new Promise((resolve) => {
    openGate = resolve;
  });
};

let h: Harness;
beforeAll(async () => {
  h = await startHarness({
    llm: new MockLlmProvider(async (request, index) => {
      if (request.task === 'extract_requirements') await gate;
      return fixtureLlmResponder(request, index);
    }),
  });
});
afterAll(async () => {
  openGate();
  await h.close();
});

const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for condition');
};

describe('job locking', () => {
  it('refuses a second generation and edits while a job is running', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent); // gate is open: generates immediately
    const created = await agent.post('/api/kits').send({
      jd: fixtureJd('jd-thin.txt'),
      company_url: h.sites.urls['no-careers'],
      days: 2,
    });
    const id = created.body.kit.id;

    closeGate();
    const first = await agent.post(`/api/kits/${id}/generate`);
    expect(first.status).toBe(202);
    await waitFor(
      async () => (await GenerationJobModel.findById(first.body.job.id))?.status === 'running',
    );

    const second = await agent.post(`/api/kits/${id}/generate`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('JOB_IN_PROGRESS');
    expect(second.body.error.details.job.id).toBe(first.body.job.id);

    const listed = (await agent.get('/api/kits')).body.kits.find(
      (k: { id: string }) => k.id === id,
    );
    expect(listed).toMatchObject({ status: 'generating', latest_job: { status: 'running' } });

    // an unrelated kit can still be edited meanwhile
    const other = await agent.patch(`/api/kits/${kit.id}`).send({ days_available: 4 });
    expect(other.status).toBe(200);

    openGate();
    await h.jobs.idle();
    expect((await agent.get(`/api/kits/${id}`)).body.kit.status).toBe('ready');
  });

  it('blocks edits to a kit while a regeneration job runs', async () => {
    const agent = await signedInAgent(h.app);
    const kit = await generatedKit(h, agent);
    // simulate a regeneration job that is still running
    const job = await GenerationJobModel.create({
      kitId: kit.id,
      userId: (await Kit.findById(kit.id))!.userId,
      type: 'regenerate_questions',
      category: 'technical',
      status: 'running',
    });
    const blocked = await agent.patch(`/api/kits/${kit.id}`).send({ days_available: 3 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('JOB_IN_PROGRESS');
    await GenerationJobModel.updateOne({ _id: job._id }, { $set: { status: 'failed' } });
    expect((await agent.patch(`/api/kits/${kit.id}`).send({ days_available: 3 })).status).toBe(200);
  });
});

describe('restart recovery', () => {
  it('fails interrupted jobs and resumes queued ones', async () => {
    const agent = await signedInAgent(h.app);
    const created = await agent.post('/api/kits').send({
      jd: fixtureJd('jd-thin.txt'),
      company_url: h.sites.urls['no-careers'],
      days: 1,
      allow_duplicate: true,
    });
    const interruptedKit = await Kit.findById(created.body.kit.id);
    await Kit.updateOne({ _id: interruptedKit!._id }, { $set: { status: 'generating' } });
    const interrupted = await GenerationJobModel.create({
      kitId: interruptedKit!._id,
      userId: interruptedKit!.userId,
      type: 'generate',
      status: 'running',
      currentStage: 'researching_company',
    });

    const queuedKit = await agent.post('/api/kits').send({
      jd: fixtureJd('jd-frontend.txt'),
      company_url: h.sites.urls['relative-links'],
      days: 2,
      allow_duplicate: true,
    });
    const queued = await GenerationJobModel.create({
      kitId: queuedKit.body.kit.id,
      userId: interruptedKit!.userId,
      type: 'generate',
      status: 'queued',
    });

    await h.jobs.recover();
    await h.jobs.idle();

    const failed = await GenerationJobModel.findById(interrupted._id).lean();
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed!.error).toMatchObject({ retryable: true, stage: 'researching_company' });
    expect((await Kit.findById(interruptedKit!._id).lean())!.status).toBe('failed');
    expect((await GenerationJobModel.findById(queued._id).lean())!.status).toBe('completed');
  });
});
