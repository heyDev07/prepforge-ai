import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  HttpClient,
  MockLlmProvider,
  StaticSearchProvider,
  type LlmProvider,
} from '@prepforge/pipeline';
import {
  fixtureLlmResponder,
  startMockSites,
  type MockSitesHandle,
} from '@prepforge/pipeline/testing';
import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import supertest from 'supertest';
import { createApp } from '../../src/app';
import { loadApiConfig, type ApiConfig } from '../../src/config';
import { JobRunner } from '../../src/services/job-runner';
import { MongoCacheStore } from '../../src/services/mongo-cache';

export const WEB_ORIGIN = 'http://localhost:3000';

export const fixtureJd = (name: string) =>
  readFileSync(new URL(`../../../../fixtures/cases/${name}`, import.meta.url), 'utf8');

/** Uses a local mongod when available (fast, offline); otherwise mongodb-memory-server downloads one. */
function systemMongod(): string | undefined {
  if (process.env.MONGOMS_SYSTEM_BINARY) return process.env.MONGOMS_SYSTEM_BINARY;
  try {
    return (
      execSync('command -v mongod', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export interface Harness {
  app: Express;
  config: ApiConfig;
  jobs: JobRunner;
  sites: MockSitesHandle;
  close: () => Promise<void>;
}

export async function startHarness(
  options: { llm?: LlmProvider; env?: Record<string, string> } = {},
): Promise<Harness> {
  const binary = systemMongod();
  const mongo = await MongoMemoryServer.create(binary ? { binary: { systemBinary: binary } } : {});
  await mongoose.connect(mongo.getUri('prepforge-test'));

  const config = loadApiConfig({
    NODE_ENV: 'test',
    CORS_ORIGINS: WEB_ORIGIN,
    LLM_PROVIDER: 'mock',
    CRAWL_DELAY_MS: '0',
    MAX_RETRIES: '1',
    REQUEST_TIMEOUT_MS: '1000',
    ALLOW_PRIVATE_URLS: 'true',
    AUTH_RATE_LIMIT: '1000',
    ...options.env,
  });
  const jobs = new JobRunner(config, {
    llm: options.llm ?? new MockLlmProvider(fixtureLlmResponder),
    http: new HttpClient({ sleep: async () => undefined }),
    search: new StaticSearchProvider([]),
    policy: { allowPrivateNetwork: true },
    cache: new MongoCacheStore(),
  });
  const sites = await startMockSites();

  return {
    app: createApp({ config, jobs }),
    config,
    jobs,
    sites,
    close: async () => {
      await jobs.idle();
      await sites.close();
      await mongoose.disconnect();
      await mongo.stop();
    },
  };
}

let counter = 0;

/** A logged-in agent (cookies persist between requests). */
export async function signedInAgent(
  app: Express,
  email = `user${++counter}-${Date.now()}@example.com`,
) {
  const agent = supertest.agent(app);
  const response = await agent
    .post('/api/auth/register')
    .send({ email, password: 'correct horse battery' });
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${response.text}`);
  }
  return agent;
}

/** Creates a kit and runs generation to completion. */
export async function generatedKit(
  harness: Harness,
  agent: supertest.Agent,
  input: { jd?: string; site?: keyof MockSitesHandle['urls']; days?: number } = {},
) {
  const created = await agent.post('/api/kits').send({
    jd: input.jd ?? fixtureJd('jd-backend.txt'),
    company_url: harness.sites.urls[input.site ?? 'acme-careers'],
    days: input.days ?? 5,
    allow_duplicate: true,
  });
  if (created.status !== 201) throw new Error(`create failed: ${created.status} ${created.text}`);
  const id = created.body.kit.id as string;
  const started = await agent.post(`/api/kits/${id}/generate`);
  if (started.status !== 202) throw new Error(`generate failed: ${started.status} ${started.text}`);
  await harness.jobs.idle();
  const kit = await fetchKit(agent, id);
  if (!kit.kit) {
    throw new Error(
      `generation did not produce a kit: ${JSON.stringify(kit.latest_job?.error ?? kit.status)}`,
    );
  }
  return kit;
}

/** GET /api/kits/:id, failing loudly with the status and body if the request did not succeed. */
export async function fetchKit(agent: supertest.Agent, id: string) {
  const response = await agent.get(`/api/kits/${id}`);
  if (response.status !== 200) {
    throw new Error(`GET /api/kits/${id} returned ${response.status}: ${response.text}`);
  }
  return response.body.kit;
}
