/** Optional keyed provider: Brave Search API (SEARCH_PROVIDER=brave, BRAVE_API_KEY). */
import { z } from 'zod';
import type { HttpClient } from '../net/http-client';
import { htmlToText } from './html-text';
import type { SearchProvider, SearchResult } from './provider';

const ResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(z.object({ url: z.string(), title: z.string(), description: z.string().nullish() }))
        .default([]),
    })
    .optional(),
});

export interface BraveSearchOptions {
  apiKey: string;
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';

  constructor(
    private readonly http: HttpClient,
    private readonly options: BraveSearchOptions,
  ) {}

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '10');

    const response = await this.http.get(url.toString(), {
      expect: 'json',
      timeoutMs: this.options.timeoutMs,
      maxRetries: this.options.maxRetries,
      maxBytes: 2_000_000,
      userAgent: this.options.userAgent,
      policy: { allowPrivateNetwork: false },
      headers: { 'x-subscription-token': this.options.apiKey },
      signal,
    });
    const data = ResponseSchema.parse(JSON.parse(response.body));
    return (data.web?.results ?? []).map((result) => ({
      url: result.url,
      title: htmlToText(result.title),
      snippet: htmlToText(result.description),
    }));
  }
}
