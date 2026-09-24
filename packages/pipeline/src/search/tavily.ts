/**
 * Tavily Search API (SEARCH_PROVIDER=tavily, TAVILY_API_KEY). A general web search built for
 * LLM applications: each result includes a cleaned excerpt of the page, which gives the
 * interview-research stage far more to work with than titles alone. A basic search costs one
 * API credit; the interview stage runs four searches per kit.
 */
import { z } from 'zod';
import type { HttpClient } from '../net/http-client';
import type { SearchProvider, SearchResult } from './provider';

const ResponseSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().nullish(),
        content: z.string().nullish(),
      }),
    )
    .default([]),
});

export interface TavilySearchOptions {
  apiKey: string;
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  maxResults?: number;
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';

  constructor(
    private readonly http: HttpClient,
    private readonly options: TavilySearchOptions,
  ) {}

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await this.http.postJson(
      'https://api.tavily.com/search',
      {
        query,
        search_depth: 'basic',
        topic: 'general',
        max_results: this.options.maxResults ?? 8,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      },
      {
        expect: 'json',
        timeoutMs: this.options.timeoutMs,
        maxRetries: this.options.maxRetries,
        maxBytes: 2_000_000,
        userAgent: this.options.userAgent,
        policy: { allowPrivateNetwork: false },
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        signal,
      },
    );
    const data = ResponseSchema.parse(JSON.parse(response.body));
    return data.results.map((result) => ({
      url: result.url,
      title: result.title?.trim() || result.url,
      snippet: result.content ?? '',
    }));
  }
}
