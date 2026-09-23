/** Search abstraction for public interview research. Providers only fetch; relevance is decided by code. */
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, signal?: AbortSignal): Promise<SearchResult[]>;
}

/** Test/offline provider that returns canned results. */
export class StaticSearchProvider implements SearchProvider {
  readonly name = 'static';
  readonly queries: string[] = [];

  constructor(
    private readonly results:
      SearchResult[] | ((query: string) => SearchResult[] | Promise<SearchResult[]>),
  ) {}

  async search(query: string): Promise<SearchResult[]> {
    this.queries.push(query);
    return typeof this.results === 'function' ? this.results(query) : this.results;
  }
}
