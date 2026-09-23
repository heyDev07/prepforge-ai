import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { BatchOutputSchema, type BatchOutput } from '@prepforge/shared';
import {
  HttpClient,
  loadPipelineConfig,
  MemoryCache,
  MockLlmProvider,
  StaticSearchProvider,
} from '@prepforge/pipeline';
import {
  fixtureLlmResponder,
  startMockSites,
  type MockSitesHandle,
} from '@prepforge/pipeline/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BatchInputError, evaluateCases, type EvaluatorDeps } from '../lib/evaluator';

const root = resolve(import.meta.dirname, '../..');
const jd = (name: string) => readFile(join(root, 'fixtures/cases', name), 'utf8');
const config = loadPipelineConfig({ LLM_PROVIDER: 'mock', CRAWL_DELAY_MS: '0', MAX_RETRIES: '1' });

let sites: MockSitesHandle;
beforeAll(async () => {
  sites = await startMockSites();
});
afterAll(() => sites.close());

function deps(): EvaluatorDeps {
  return {
    config,
    llm: new MockLlmProvider(fixtureLlmResponder),
    http: new HttpClient({ sleep: async () => undefined }),
    search: new StaticSearchProvider([]),
    policy: { allowPrivateNetwork: true },
    cache: new MemoryCache(),
  };
}

const run = (cases: unknown, caseTimeoutMs = 30_000) =>
  evaluateCases(cases, deps(), { concurrency: 2, caseTimeoutMs });

describe('evaluateCases', () => {
  it('builds a valid kit for a successful localhost case', async () => {
    const output = await run([
      {
        id: 'case-01',
        jd: await jd('jd-backend.txt'),
        company_url: sites.urls['acme-careers'],
        days: 5,
      },
    ]);
    expect(BatchOutputSchema.safeParse(output).success).toBe(true);
    expect(output.kits[0]).toMatchObject({ id: 'case-01', status: 'ok', error: null });
    expect(output.kits[0]!.kit!.schedule.days).toHaveLength(5);
    expect(output.kits[0]!.kit!.source.company_url).toBe(sites.urls['acme-careers']);
  });

  it('records a failed case with a structured error', async () => {
    const output = await run([
      { id: 'case-04', jd: await jd('jd-thin.txt'), company_url: 'http://localhost:1', days: 2 },
    ]);
    expect(output.kits[0]).toEqual({
      id: 'case-04',
      status: 'failed',
      kit: null,
      error: { code: 'COMPANY_UNREACHABLE', message: expect.any(String) },
    });
  });

  it('continues after failures and preserves input IDs and order in mixed batches', async () => {
    const backend = await jd('jd-backend.txt');
    const output = await run([
      { id: 'a', jd: backend, company_url: sites.urls['acme-careers'], days: 3 },
      { id: 'b', jd: backend, company_url: 'http://localhost:1', days: 3 },
      { id: 'c', jd: await jd('jd-thin.txt'), company_url: sites.urls['no-careers'], days: 1 },
      { id: 'd', jd: 'short', company_url: sites.urls['no-careers'], days: 1 },
    ]);
    expect(output.kits.map((k) => [k.id, k.status])).toEqual([
      ['a', 'ok'],
      ['b', 'failed'],
      ['c', 'ok'],
      ['d', 'failed'],
    ]);
    expect(output.kits[3]!.error!.code).toBe('INVALID_INPUT');
    expect(output.kits[2]!.kit!.schedule.days).toHaveLength(1);
  });

  it('uses the days from each case', async () => {
    const thin = await jd('jd-thin.txt');
    const output = await run(
      [1, 7, 60].map((days) => ({
        id: `d${days}`,
        jd: thin,
        company_url: sites.urls['no-careers'],
        days,
      })),
    );
    expect(output.kits.map((k) => k.kit!.schedule.days.length)).toEqual([1, 7, 60]);
  });

  it('reports malformed individual cases without stopping the batch', async () => {
    const output = await run([
      null,
      { jd: 'x' },
      { id: '', jd: 'x' },
      { id: 'no-days', jd: await jd('jd-thin.txt'), company_url: sites.urls['no-careers'] },
    ]);
    expect(output.kits.map((k) => [k.id, k.status, k.error?.code])).toEqual([
      ['case-1', 'failed', 'INVALID_INPUT'],
      ['case-2', 'failed', 'INVALID_INPUT'],
      ['case-3', 'failed', 'INVALID_INPUT'],
      ['no-days', 'failed', 'INVALID_INPUT'],
    ]);
  });

  it('turns a case that runs out of time into PIPELINE_TIMEOUT', async () => {
    const output = await run(
      [
        {
          id: 'slow',
          jd: await jd('jd-backend.txt'),
          company_url: sites.urls['acme-careers'],
          days: 3,
        },
      ],
      1,
    );
    expect(output.kits[0]!.error!.code).toBe('PIPELINE_TIMEOUT');
  });

  it('rejects input that is not an array', async () => {
    await expect(run({ id: 'x' })).rejects.toBeInstanceOf(BatchInputError);
  });
});

describe('npm run evaluate (CLI)', () => {
  const execFileAsync = promisify(execFile);
  const tsx = join(root, 'node_modules/.bin/tsx');
  const env = {
    ...process.env,
    LLM_PROVIDER: 'mock',
    SEARCH_PROVIDER: 'none',
    CRAWL_DELAY_MS: '0',
    MAX_RETRIES: '1',
  };

  async function cli(args: string[]) {
    try {
      const { stderr } = await execFileAsync(tsx, ['scripts/evaluate.ts', ...args], {
        cwd: root,
        env,
      });
      return { code: 0, stderr };
    } catch (error) {
      const e = error as { code: number; stderr: string };
      return { code: e.code, stderr: e.stderr };
    }
  }

  it('writes the output file for --input/--output and exits 0 even when a case fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prepforge-eval-'));
    const input = join(dir, 'cases.json');
    const output = join(dir, 'kits.json');
    await writeFile(
      input,
      JSON.stringify([
        {
          id: 'case-01',
          jd: await jd('jd-frontend.txt'),
          company_url: sites.urls['relative-links'],
          days: 3,
        },
        { id: 'case-02', jd: await jd('jd-thin.txt'), company_url: 'http://localhost:1', days: 2 },
      ]),
    );
    const result = await cli(['--input', input, '--output', output]);
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/1 ok, 1 failed/);
    const written = BatchOutputSchema.parse(
      JSON.parse(await readFile(output, 'utf8')),
    ) as BatchOutput;
    expect(written.kits.map((k) => k.status)).toEqual(['ok', 'failed']);
  });

  it.each([
    [['--input', 'fixtures/cases/sample-cases.json'], /Usage/],
    [['--input', 'does-not-exist.json', '--output', 'x.json'], /Could not read/],
    [['--bogus'], /Unknown option/],
  ])('exits 2 for bad arguments %j', async (args, message) => {
    const result = await cli(args);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(message);
  });

  it('exits 2 for a malformed input file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prepforge-eval-'));
    await writeFile(join(dir, 'broken.json'), '{ not json');
    await writeFile(join(dir, 'object.json'), '{"id":"x"}');
    expect(
      (await cli(['--input', join(dir, 'broken.json'), '--output', join(dir, 'o.json')])).code,
    ).toBe(2);
    const notArray = await cli([
      '--input',
      join(dir, 'object.json'),
      '--output',
      join(dir, 'o.json'),
    ]);
    expect(notArray.code).toBe(2);
    expect(notArray.stderr).toMatch(/JSON array/);
  });
});
