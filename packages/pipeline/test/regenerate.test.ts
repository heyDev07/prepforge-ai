import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPipelineConfig } from '../src/config';
import { addQuestion, updateCompanyBrief, updateQuestion } from '../src/editing/mutations';
import { toExternalKit } from '../src/editing/project';
import { MockLlmProvider } from '../src/llm/mock';
import { HttpClient } from '../src/net/http-client';
import { rebuildSchedule, regenerateCategory, regenerateCompanyBrief } from '../src/regenerate';
import { runPipeline, type PipelineResult } from '../src/run-pipeline';
import { StaticSearchProvider } from '../src/search/provider';
import { fixtureLlmResponder } from '../src/testing/fixture-llm';
import { startMockSites, type MockSitesHandle } from '../src/testing';
import { validateKit } from '../src/validation/validate-kit';

const config = loadPipelineConfig({ LLM_PROVIDER: 'mock', CRAWL_DELAY_MS: '0', MAX_RETRIES: '1' });
const jd = readFileSync(new URL('../../../fixtures/cases/jd-backend.txt', import.meta.url), 'utf8');

let sites: MockSitesHandle;
let base: PipelineResult;

beforeAll(async () => {
  sites = await startMockSites({ sites: ['acme-careers'] });
  base = await runPipeline(
    { jd, company_url: sites.urls['acme-careers'], days: 5 },
    {
      config,
      llm: new MockLlmProvider(fixtureLlmResponder),
      http: new HttpClient(),
      search: new StaticSearchProvider([]),
      policy: { allowPrivateNetwork: true },
    },
  );
});
afterAll(() => sites.close());

/** The fixture model, with a distinct wording on regeneration so replacements are visible. */
function regenLlm() {
  return new MockLlmProvider((request, index) => {
    const reply = fixtureLlmResponder(request, index) as string;
    if (!request.task.startsWith('questions')) return reply;
    const parsed = JSON.parse(reply) as { questions: { prompt: string }[] };
    parsed.questions = parsed.questions.map((q) => ({ ...q, prompt: `Regenerated: ${q.prompt}` }));
    return JSON.stringify(parsed);
  });
}

function editedKit() {
  const technical = base.kit.questions.filter((q) => q.category === 'technical');
  let kit = base.kit;
  kit = updateQuestion(kit, technical[0]!.id, { prompt: 'My own wording of this question?' }).kit;
  kit = updateQuestion(kit, technical[1]!.id, { pinned: true }).kit;
  kit = addQuestion(kit, {
    category: 'technical',
    prompt: 'A question I wrote myself?',
    answer_outline: '- my notes',
    difficulty: 2,
    requirement_ids: ['r1'],
  }).kit;
  return {
    kit,
    edited: technical[0]!.id,
    pinned: technical[1]!.id,
    generated: technical.slice(2).map((q) => q.id),
  };
}

describe('regenerateCategory', () => {
  it('keeps edited, pinned and user-created questions and replaces generated ones', async () => {
    const { kit, edited, pinned, generated } = editedKit();
    const userId = kit.questions.find((q) => q.origin === 'user')!.id;
    const result = await regenerateCategory(kit, 'technical', base.research, {
      config,
      llm: regenLlm(),
    });
    const ids = result.kit.questions.map((q) => q.id);

    expect(ids).toEqual(expect.arrayContaining([edited, pinned, userId]));
    expect(result.kit.questions.find((q) => q.id === edited)!.prompt).toBe(
      'My own wording of this question?',
    );
    for (const id of generated) expect(ids).not.toContain(id);
    expect(result.removedIds.sort()).toEqual(generated.sort());
    expect(result.addedIds.length).toBeGreaterThan(0);
    for (const id of result.addedIds) {
      expect(result.kit.questions.find((q) => q.id === id)!.prompt).toMatch(/^Regenerated: /);
    }
    const highest = Math.max(...kit.questions.map((q) => Number(q.id.slice(1))));
    for (const id of result.addedIds) expect(Number(id.slice(1))).toBeGreaterThan(highest);
  });

  it('does not touch any other section', async () => {
    const { kit } = editedKit();
    const result = await regenerateCategory(kit, 'technical', base.research, {
      config,
      llm: regenLlm(),
    });
    const others = (k: typeof kit) => k.questions.filter((q) => q.category !== 'technical');
    expect(others(result.kit)).toEqual(others(kit));
    expect(result.kit.flashcards).toEqual(kit.flashcards);
    expect(result.kit.company_brief).toEqual(kit.company_brief);
    expect(result.kit.role).toEqual(kit.role);
    expect(result.kit.source).toEqual(kit.source);
  });

  it('keeps the kit valid and fully covered, filling gaps only in the same category', async () => {
    const llm = regenLlm();
    const result = await regenerateCategory(base.kit, 'behavioural', base.research, {
      config,
      llm,
    });
    expect(validateKit(toExternalKit(result.kit)).errors).toEqual([]);
    expect(result.kit.coverage.uncovered_requirement_ids).toEqual([]);
    const gapFills = llm.calls.filter((c) => c.task.startsWith('questions_gap_fill'));
    expect(gapFills.every((c) => c.task === 'questions_gap_fill:behavioural')).toBe(true);
  });
});

describe('regenerateCompanyBrief', () => {
  const deps = { config, llm: new MockLlmProvider(fixtureLlmResponder) };

  it('refuses to overwrite a pinned brief', async () => {
    const pinned = updateCompanyBrief(base.kit, { pinned: true });
    await expect(regenerateCompanyBrief(pinned, base.research, deps, { jd })).rejects.toMatchObject(
      {
        code: 'CONFLICT',
      },
    );
  });

  it('asks for confirmation before replacing an edited brief', async () => {
    const edited = updateCompanyBrief(base.kit, { summary: 'My notes about the company.' });
    await expect(regenerateCompanyBrief(edited, base.research, deps, { jd })).rejects.toMatchObject(
      {
        code: 'CONFIRMATION_REQUIRED',
      },
    );
    const replaced = await regenerateCompanyBrief(edited, base.research, deps, { jd, force: true });
    expect(replaced.company_brief.state).toBe('generated');
    expect(replaced.company_brief.summary).not.toBe('My notes about the company.');
  });

  it('moves citation labels written into the prose to the source list', async () => {
    const llm = new MockLlmProvider({
      company_brief: JSON.stringify({
        what_they_do: 'Acme builds warehouse robots (S1).',
        summary: 'It sells to logistics firms [S1, S2]. Candidates report a take-home [P1][S9].',
        cited_sources: [],
      }),
    });
    const kit = await regenerateCompanyBrief(base.kit, base.research, { config, llm }, { jd });
    expect(kit.company_brief.what_they_do).toBe('Acme builds warehouse robots.');
    expect(kit.company_brief.summary).toMatch(
      /^It sells to logistics firms\. Candidates report a take-home\./,
    );
    expect(kit.company_brief.summary).not.toMatch(/\b[SP]\d\b/);
    // S1 counts once despite two mentions; P1 and S9 are not sources in this research
    expect(kit.company_brief.sources).toHaveLength(2);
    expect(new Set(kit.company_brief.sources).size).toBe(2);
  });

  it('changes only the brief', async () => {
    const kit = updateQuestion(base.kit, base.kit.questions[0]!.id, { prompt: 'Edited?' }).kit;
    const result = await regenerateCompanyBrief(kit, base.research, deps, { jd });
    expect(result.questions).toEqual(kit.questions);
    expect(result.flashcards).toEqual(kit.flashcards);
    expect(result.schedule).toEqual(kit.schedule);
  });
});

describe('rebuildSchedule', () => {
  it('moves questions for weak requirements earlier', () => {
    const lastRequirement = base.kit.role.requirements.filter((r) => r.priority === 'must').at(-1)!;
    const position = (kit: typeof base.kit) =>
      kit.schedule.days
        .flatMap((d) => d.question_ids)
        .findIndex((id) =>
          kit.questions.find((q) => q.id === id)!.requirement_ids.includes(lastRequirement.id),
        );
    const weak = rebuildSchedule(base.kit, { weakRequirementIds: new Set([lastRequirement.id]) });
    expect(position(weak)).toBeLessThanOrEqual(position(base.kit));
    expect(weak.schedule.days).toHaveLength(5);
  });
});
