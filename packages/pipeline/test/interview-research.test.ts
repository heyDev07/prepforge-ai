import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/net/http-client';
import { HnAlgoliaSearchProvider } from '../src/search/hn-algolia';
import {
  companyIdentifiers,
  isRelevant,
  researchInterviews,
} from '../src/search/interview-research';
import { StaticSearchProvider, type SearchProvider } from '../src/search/provider';

const company = { companyName: 'Acme Robotics', companyUrl: 'https://www.acme-robotics.com/' };

const relevant = {
  url: 'https://news.ycombinator.com/item?id=1',
  title: 'Ask HN: Acme Robotics interview process?',
  snippet: 'Recruiter call, then a take-home and a system design round.',
};
const unrelatedCompany = {
  url: 'https://news.ycombinator.com/item?id=2',
  title: 'Globex interview experience',
  snippet: 'Four rounds of leetcode.',
};
const noInterviewSignal = {
  url: 'https://news.ycombinator.com/item?id=3',
  title: 'Acme Robotics raises Series B',
  snippet: 'The warehouse robotics company raised $40M.',
};

describe('relevance filter', () => {
  it('builds identifiers from the company name and a distinctive domain label', () => {
    expect(companyIdentifiers('Acme Robotics', 'https://www.acme-robotics.com')).toEqual([
      'acme robotics',
    ]);
    expect(companyIdentifiers('Northwind', 'https://northwindpay.example')).toEqual([
      'northwind',
      'northwindpay',
    ]);
    expect(companyIdentifiers('Acme', 'http://localhost:4010/')).toEqual(['acme']);
  });

  it('requires both the company and an interview signal', () => {
    const ids = companyIdentifiers(company.companyName, company.companyUrl);
    expect(isRelevant(relevant, ids)).toBe(true);
    expect(isRelevant(unrelatedCompany, ids)).toBe(false);
    expect(isRelevant(noInterviewSignal, ids)).toBe(false);
  });

  it('matches whole words only', () => {
    expect(
      isRelevant({ url: 'x', title: 'Acmeish Roboticsco interview', snippet: '' }, [
        'acme robotics',
      ]),
    ).toBe(false);
  });
});

describe('researchInterviews', () => {
  it('runs every interview query and keeps relevant, de-duplicated results', async () => {
    const provider = new StaticSearchProvider([
      relevant,
      unrelatedCompany,
      noInterviewSignal,
      relevant,
    ]);
    const result = await researchInterviews(company, provider);
    expect(provider.queries).toEqual([
      'Acme Robotics interview process',
      'Acme Robotics technical interview',
      'Acme Robotics interview questions',
      'Acme Robotics hiring process',
    ]);
    expect(result.status).toBe('found');
    expect(result.results).toEqual([{ ...relevant, source_type: 'public_discussion' }]);
  });

  it('returns an explicit not_found instead of inventing information', async () => {
    const result = await researchInterviews(company, new StaticSearchProvider([unrelatedCompany]));
    expect(result).toMatchObject({ status: 'not_found', results: [], error: null });
  });

  it('is unavailable when search is disabled', async () => {
    const result = await researchInterviews(company, null);
    expect(result).toMatchObject({ status: 'unavailable', provider: 'none' });
  });

  it('is unavailable when every query fails, but tolerates partial failures', async () => {
    const failing: SearchProvider = {
      name: 'broken',
      search: async () => {
        throw new Error('HTTP 503');
      },
    };
    expect(await researchInterviews(company, failing)).toMatchObject({
      status: 'unavailable',
      error: 'Public search failed: HTTP 503',
    });

    let calls = 0;
    const flaky = new StaticSearchProvider(() => {
      if (calls++ === 0) throw new Error('timeout');
      return [relevant];
    });
    expect((await researchInterviews(company, flaky)).status).toBe('found');
  });

  it('sanitises and truncates snippets', async () => {
    const long = { ...relevant, snippet: `interview \u200b${'a'.repeat(1_000)}` };
    const result = await researchInterviews(company, new StaticSearchProvider([long]));
    const snippet = result.results[0]!.snippet;
    expect(snippet.length).toBeLessThanOrEqual(600);
    expect(snippet).not.toContain('\u200b');
  });
});

describe('HnAlgoliaSearchProvider', () => {
  it('maps stories and comments to discussion links with plain-text snippets', async () => {
    const body = JSON.stringify({
      hits: [
        {
          objectID: '11',
          title: 'Acme Robotics interview process',
          story_text: null,
          _tags: ['story'],
        },
        {
          objectID: '12',
          story_title: 'Ask HN: Robotics interviews',
          comment_text: '<p>At Acme Robotics the <i>onsite</i> was 4&nbsp;hours.</p>',
          _tags: ['comment'],
        },
      ],
    });
    const requested: string[] = [];
    const http = new HttpClient({
      fetch: (async (input: URL) => {
        requested.push(input.toString());
        return new Response(body, { headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch,
      lookup: async () => ['93.184.216.34'],
    });
    const provider = new HnAlgoliaSearchProvider(http, {
      userAgent: 'PrepForgeBot/test',
      timeoutMs: 1_000,
      maxRetries: 0,
    });

    const results = await provider.search('Acme Robotics interview process');
    expect(requested[0]).toContain(
      'hn.algolia.com/api/v1/search?query=Acme+Robotics+interview+process',
    );
    expect(results).toEqual([
      {
        url: 'https://news.ycombinator.com/item?id=11',
        title: 'Acme Robotics interview process',
        snippet: 'Acme Robotics interview process',
      },
      {
        url: 'https://news.ycombinator.com/item?id=12',
        title: 'Comment on: Ask HN: Robotics interviews',
        snippet: 'At Acme Robotics the onsite was 4 hours.',
      },
    ]);
  });
});
