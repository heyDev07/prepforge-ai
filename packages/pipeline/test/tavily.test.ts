import { describe, expect, it } from 'vitest';
import { loadPipelineConfig } from '../src/config';
import { HttpClient } from '../src/net/http-client';
import type { FetchFailure } from '../src/net/errors';
import { createSearchProvider } from '../src/search/factory';
import { researchInterviews } from '../src/search/interview-research';
import { TavilySearchProvider } from '../src/search/tavily';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json' } });

function client(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = new HttpClient({
    fetch: (async (input: URL, init: RequestInit) => {
      calls.push({ url: input.toString(), init });
      return handler(input.toString(), init);
    }) as unknown as typeof fetch,
    lookup: async () => ['93.184.216.34'],
    sleep: async () => undefined,
  });
  return { http, calls };
}

const options = {
  apiKey: 'tvly-test',
  userAgent: 'PrepForgeBot/test',
  timeoutMs: 1_000,
  maxRetries: 1,
};

describe('TavilySearchProvider', () => {
  it('POSTs an authenticated basic search and maps results with their page excerpts', async () => {
    const { http, calls } = client(() =>
      json({
        results: [
          {
            title: 'Acme Robotics interview experience',
            url: 'https://example.com/acme-interview',
            content: 'Recruiter call, then a take-home and a system design round.',
            score: 0.9,
          },
          { title: null, url: 'https://example.com/untitled', content: null },
        ],
      }),
    );
    const results = await new TavilySearchProvider(http, options).search(
      'Acme Robotics interview process',
    );

    expect(calls[0]!.url).toBe('https://api.tavily.com/search');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tvly-test');
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      query: 'Acme Robotics interview process',
      search_depth: 'basic',
      include_answer: false,
    });
    expect(results).toEqual([
      {
        url: 'https://example.com/acme-interview',
        title: 'Acme Robotics interview experience',
        snippet: 'Recruiter call, then a take-home and a system design round.',
      },
      { url: 'https://example.com/untitled', title: 'https://example.com/untitled', snippet: '' },
    ]);
  });

  it('still applies the relevance filter to Tavily results', async () => {
    const { http } = client(() =>
      json({
        results: [
          {
            title: 'Acme Robotics interview process',
            url: 'https://a.example/1',
            content: 'Onsite with system design.',
          },
          {
            title: 'Acme Robotics raises funding',
            url: 'https://a.example/2',
            content: 'Series B news.',
          },
        ],
      }),
    );
    const research = await researchInterviews(
      { companyName: 'Acme Robotics', companyUrl: 'https://acme-robotics.com' },
      new TavilySearchProvider(http, options),
    );
    expect(research).toMatchObject({ status: 'found', provider: 'tavily' });
    expect(research.results.map((r) => r.url)).toEqual(['https://a.example/1']);
  });

  it('reports an invalid key as an unavailable search, not a failed kit', async () => {
    const { http } = client(() => json({ detail: { error: 'Unauthorized' } }, { status: 401 }));
    const research = await researchInterviews(
      { companyName: 'Acme Robotics', companyUrl: 'https://acme-robotics.com' },
      new TavilySearchProvider(http, options),
    );
    expect(research.status).toBe('unavailable');
    expect(research.error).toMatch(/HTTP 401/);
  });

  it('never follows redirects on POST', async () => {
    const { http, calls } = client(
      () =>
        new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }),
    );
    const failure = await http
      .postJson(
        'https://api.tavily.com/search',
        {},
        { ...options, expect: 'json', maxBytes: 1_000, policy: { allowPrivateNetwork: false } },
      )
      .catch((e: FetchFailure) => e);
    expect(failure).toMatchObject({ status: 'redirect_error' });
    expect(calls).toHaveLength(1);
  });
});

describe('createSearchProvider', () => {
  it('uses Tavily by default when a key is set, and falls back to the keyless provider without one', () => {
    const http = new HttpClient();
    expect(createSearchProvider(loadPipelineConfig({ TAVILY_API_KEY: 'tvly-x' }), http)?.name).toBe(
      'tavily',
    );
    expect(createSearchProvider(loadPipelineConfig({}), http)?.name).toBe('hn-algolia');
    expect(createSearchProvider(loadPipelineConfig({ SEARCH_PROVIDER: 'none' }), http)).toBeNull();
  });
});
