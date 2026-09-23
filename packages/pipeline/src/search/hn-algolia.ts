/**
 * Keyless default: the official Hacker News Algolia search API (https://hn.algolia.com/api),
 * a public API intended for programmatic use. Results link to the HN discussion.
 */
import { z } from 'zod';
import type { HttpClient } from '../net/http-client';
import { htmlToText } from './html-text';
import type { SearchProvider, SearchResult } from './provider';

const HitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullish(),
  story_title: z.string().nullish(),
  story_text: z.string().nullish(),
  comment_text: z.string().nullish(),
  _tags: z.array(z.string()).default([]),
});
const ResponseSchema = z.object({ hits: z.array(HitSchema) });

export interface HnAlgoliaOptions {
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  hitsPerPage?: number;
}

export class HnAlgoliaSearchProvider implements SearchProvider {
  readonly name = 'hn-algolia';

  constructor(
    private readonly http: HttpClient,
    private readonly options: HnAlgoliaOptions,
  ) {}

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const url = new URL('https://hn.algolia.com/api/v1/search');
    url.searchParams.set('query', query);
    url.searchParams.set('tags', '(story,comment)');
    url.searchParams.set('hitsPerPage', String(this.options.hitsPerPage ?? 10));

    const response = await this.http.get(url.toString(), {
      expect: 'json',
      timeoutMs: this.options.timeoutMs,
      maxRetries: this.options.maxRetries,
      maxBytes: 2_000_000,
      userAgent: this.options.userAgent,
      policy: { allowPrivateNetwork: false },
      signal,
    });
    const { hits } = ResponseSchema.parse(JSON.parse(response.body));

    return hits.map((hit) => {
      const isComment = hit._tags.includes('comment');
      const title = isComment
        ? `Comment on: ${hit.story_title ?? 'Hacker News discussion'}`
        : (hit.title ?? 'Hacker News discussion');
      const snippet = htmlToText(isComment ? hit.comment_text : (hit.story_text ?? hit.title));
      return {
        url: `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`,
        title,
        snippet,
      };
    });
  }
}
