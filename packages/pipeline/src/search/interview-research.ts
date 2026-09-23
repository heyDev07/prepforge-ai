/**
 * Public interview research. Searches for discussion of the company's interview process and
 * keeps only results that mention BOTH the company and an interview signal. Nothing is
 * fabricated: when no relevant result exists the stage returns an explicit "not_found".
 */
import type { PublicResearch, PublicResearchResult } from '@prepforge/shared';
import { collapseWhitespace, stripInvisible, truncate } from '../text/sanitize';
import type { SearchProvider, SearchResult } from './provider';

export const INTERVIEW_QUERY_TEMPLATES = [
  '{company} interview process',
  '{company} technical interview',
  '{company} interview questions',
  '{company} hiring process',
] as const;

const INTERVIEW_SIGNAL =
  /\b(interview(s|ed|ing|er|ers)?|hiring process|recruiters?|onsite|on-site|take[- ]home|leetcode|coding (challenge|test|exercise)|system design|phone screen|pair(ing)? (session|exercise))\b/i;

const MAX_SNIPPET_CHARS = 600;

function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

function sanitizeSnippet(text: string): string {
  return truncate(collapseWhitespace(stripInvisible(text)), MAX_SNIPPET_CHARS);
}

/** Names a result must mention: the company name, plus the domain label when distinctive. */
export function companyIdentifiers(companyName: string, companyUrl: string): string[] {
  const ids = new Set<string>();
  const name = normalize(companyName).trim();
  if (name.length >= 2) ids.add(name);
  try {
    const host = new URL(companyUrl).hostname.replace(/^www\./, '');
    const label = host.split('.')[0] ?? '';
    const normalizedLabel = normalize(label).trim();
    if (host.includes('.') && normalizedLabel.length >= 4) ids.add(normalizedLabel);
  } catch {
    // ignore malformed URLs
  }
  return [...ids];
}

export function isRelevant(result: SearchResult, identifiers: string[]): boolean {
  const haystack = normalize(`${result.title} ${result.snippet}`);
  const mentionsCompany = identifiers.some((id) => haystack.includes(` ${id} `));
  return mentionsCompany && INTERVIEW_SIGNAL.test(`${result.title} ${result.snippet}`);
}

export async function researchInterviews(
  input: { companyName: string; companyUrl: string },
  provider: SearchProvider | null,
  options: { maxResults?: number; signal?: AbortSignal } = {},
): Promise<PublicResearch> {
  if (!provider) {
    return {
      status: 'unavailable',
      provider: 'none',
      queries: [],
      results: [],
      error: 'Public interview search is disabled.',
    };
  }

  const identifiers = companyIdentifiers(input.companyName, input.companyUrl);
  if (identifiers.length === 0) {
    return { status: 'not_found', provider: provider.name, queries: [], results: [], error: null };
  }

  const queries = INTERVIEW_QUERY_TEMPLATES.map((t) => t.replace('{company}', input.companyName));
  const seen = new Set<string>();
  const results: PublicResearchResult[] = [];
  let failures = 0;
  let lastError: string | null = null;

  // Sequential on purpose: public search APIs are shared resources.
  for (const query of queries) {
    let hits: SearchResult[];
    try {
      hits = await provider.search(query, options.signal);
    } catch (error) {
      failures++;
      lastError = error instanceof Error ? error.message : 'Search failed.';
      continue;
    }
    for (const hit of hits) {
      if (seen.has(hit.url) || !isRelevant(hit, identifiers)) continue;
      seen.add(hit.url);
      results.push({
        url: hit.url,
        title: sanitizeSnippet(hit.title),
        snippet: sanitizeSnippet(hit.snippet),
        source_type: 'public_discussion',
      });
    }
  }

  if (failures === queries.length) {
    return {
      status: 'unavailable',
      provider: provider.name,
      queries,
      results: [],
      error: `Public search failed: ${lastError ?? 'unknown error'}`,
    };
  }
  const kept = results.slice(0, options.maxResults ?? 8);
  return {
    status: kept.length > 0 ? 'found' : 'not_found',
    provider: provider.name,
    queries,
    results: kept,
    error: null,
  };
}
