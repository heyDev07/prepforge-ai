import type { PipelineConfig } from '../config';
import type { HttpClient } from '../net/http-client';
import { BraveSearchProvider } from './brave';
import { HnAlgoliaSearchProvider } from './hn-algolia';
import { TavilySearchProvider } from './tavily';
import type { SearchProvider } from './provider';

/** Builds the configured search provider; null when public search is disabled. */
export function createSearchProvider(
  config: PipelineConfig,
  http: HttpClient,
): SearchProvider | null {
  const common = {
    userAgent: config.crawler.userAgent,
    timeoutMs: config.crawler.requestTimeoutMs,
    maxRetries: Math.min(2, config.crawler.maxRetries),
  };
  switch (config.search.provider) {
    case 'none':
      return null;
    case 'tavily':
      if (config.search.tavilyApiKey) {
        return new TavilySearchProvider(http, { ...common, apiKey: config.search.tavilyApiKey });
      }
      // No key: fall back to the keyless provider rather than failing the whole kit.
      return new HnAlgoliaSearchProvider(http, common);
    case 'brave':
      if (config.search.braveApiKey) {
        return new BraveSearchProvider(http, { ...common, apiKey: config.search.braveApiKey });
      }
      // No key: fall back to the keyless provider rather than failing the whole kit.
      return new HnAlgoliaSearchProvider(http, common);
    case 'hn':
      return new HnAlgoliaSearchProvider(http, common);
  }
}
