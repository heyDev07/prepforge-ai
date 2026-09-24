/**
 * Bounded, best-first company website crawler.
 *
 *   1. Fetch robots.txt (4xx → allow all; 5xx → disallow all, per RFC 9309;
 *      unreachable → the company site is unreachable).
 *   2. Fetch the homepage. If that fails the kit cannot be researched → COMPANY_UNREACHABLE.
 *   3. Score every same-site link (link-ranker) and keep a priority frontier.
 *   4. Repeatedly fetch the best-scoring links (bounded concurrency, per-host pacing) until
 *      MAX_PAGES is reached or no link within MAX_DEPTH scores above zero.
 *
 * Every page — fetched, failed or disallowed — is recorded so the UI can show honest gaps.
 * One failing page never stops the crawl.
 */
import { AppError, type ResearchPage } from '@prepforge/shared';
import { sleep as realSleep, type Sleep } from '../net/backoff';
import { FetchFailure, isFetchFailure } from '../net/errors';
import type { HttpClient, HttpRequestOptions } from '../net/http-client';
import { RateLimiter } from '../net/rate-limiter';
import type { UrlPolicy } from '../net/url-guard';
import { classifyPage } from './classify-page';
import { extractPage, type ExtractedLink, type ExtractedPage } from './extract-content';
import { isExcludedResource, scoreLink } from './link-ranker';
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, type RobotsRules } from './robots';
import { canonicalUrl, isSameSite } from './site';

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  maxConcurrency: number;
  requestTimeoutMs: number;
  maxPageBytes: number;
  maxRetries: number;
  userAgent: string;
  policy: UrlPolicy;
  /** Spacing between requests to the site when robots.txt sets no Crawl-delay. */
  minDelayMs?: number;
  /** Upper bound for a robots.txt Crawl-delay. */
  maxCrawlDelayMs?: number;
}

export interface CrawlDeps {
  http: HttpClient;
  now?: () => Date;
  /** Used for per-host pacing. */
  sleep?: Sleep;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
}

export type RobotsStatus = 'found' | 'missing' | 'server_error';

export interface CrawlResult {
  startUrl: string;
  /** Homepage URL after redirects. */
  homeUrl: string;
  homepage: Pick<ExtractedPage, 'title' | 'siteName' | 'description'> | null;
  robots: RobotsStatus;
  /** All attempted pages (successful and failed), homepage first, in fetch order. */
  pages: ResearchPage[];
  limitations: string[];
}

interface Candidate {
  url: URL;
  depth: number;
  score: number;
  order: number;
}

const ROBOTS_MAX_BYTES = 512_000;

/** "HTTP 503" for HTTP errors, otherwise the kind of failure ("timeout", "bad content type"). */
function describeFailure(status: string, httpStatus: number | null): string {
  return status === 'http_error' && httpStatus ? `HTTP ${httpStatus}` : status.replace(/_/g, ' ');
}

function summarizeFailure(failure: FetchFailure): string {
  return describeFailure(failure.status, failure.httpStatus);
}

export async function crawlCompanySite(
  startUrl: string,
  options: CrawlOptions,
  deps: CrawlDeps,
): Promise<CrawlResult> {
  const now = deps.now ?? (() => new Date());
  const start = new URL(startUrl);
  const pages: ResearchPage[] = [];
  const limitations: string[] = [];
  const request = (expect: HttpRequestOptions['expect']): HttpRequestOptions => ({
    expect,
    timeoutMs: options.requestTimeoutMs,
    maxBytes: options.maxPageBytes,
    // real homepages can be several MB of inline scripts and styles; the first
    // `maxPageBytes` still hold the title, visible text and most navigation links
    truncate: true,
    maxRetries: options.maxRetries,
    userAgent: options.userAgent,
    policy: options.policy,
    signal: deps.signal,
  });

  const record = (
    url: URL | string,
    depth: number,
    score: number,
    result: { page: ExtractedPage; isHome: boolean } | { failure: FetchFailure },
  ): ResearchPage => {
    const entry: ResearchPage =
      'page' in result
        ? {
            url: url.toString(),
            title: result.page.title,
            text: result.page.text,
            source_type: classifyPage(
              { url: new URL(url), title: result.page.title, h1: result.page.h1 },
              result.isHome,
            ),
            fetch_status: 'ok',
            http_status: 200,
            error: null,
            depth,
            score,
            retrieved_at: now().toISOString(),
          }
        : {
            url: url.toString(),
            title: '',
            text: '',
            source_type: classifyPage({ url: new URL(url), title: '', h1: '' }, depth === 0),
            fetch_status: result.failure.status,
            http_status: result.failure.httpStatus,
            error: result.failure.message,
            depth,
            score,
            retrieved_at: now().toISOString(),
          };
    pages.push(entry);
    return entry;
  };

  // ---- 1. robots.txt -------------------------------------------------------------------
  let robots: RobotsRules = ALLOW_ALL;
  let robotsStatus: RobotsStatus = 'missing';
  try {
    const response = await deps.http.get(new URL('/robots.txt', start).toString(), {
      ...request('text'),
      maxBytes: ROBOTS_MAX_BYTES,
      maxRetries: Math.min(1, options.maxRetries),
    });
    // RFC 9309 §2.5: parse at least the first 500 KiB; drop a rule cut off at the limit
    const body = response.truncated ? response.body.replace(/[^\n]*$/, '') : response.body;
    robots = parseRobots(body, options.userAgent);
    robotsStatus = 'found';
  } catch (error) {
    if (!isFetchFailure(error)) throw error;
    if (error.status === 'blocked_url') {
      throw new AppError('URL_NOT_ALLOWED', error.message, { status: 400 });
    }
    if (error.status === 'http_error' && (error.httpStatus ?? 0) >= 500) {
      robots = DISALLOW_ALL;
      robotsStatus = 'server_error';
      limitations.push(
        `robots.txt returned ${summarizeFailure(error)}, so the site was treated as disallowed (RFC 9309).`,
      );
    } else if (error.status === 'timeout' || error.status === 'network_error') {
      throw new AppError(
        'COMPANY_UNREACHABLE',
        `The company website ${start.origin} could not be reached (${summarizeFailure(error)}).`,
        { retryable: true, status: 422 },
      );
    }
    // 4xx, redirects elsewhere, odd content types: no usable robots.txt → allow all
  }

  const crawlDelay = Math.min(
    robots.crawlDelayMs ?? options.minDelayMs ?? 200,
    options.maxCrawlDelayMs ?? 5_000,
  );
  const pacing = new RateLimiter({
    limit: 1,
    windowMs: Math.max(0, crawlDelay),
    sleep: deps.sleep ?? realSleep,
  });

  const report = () => {
    const ok = pages.filter((p) => p.fetch_status === 'ok').length;
    const failed = pages.filter(
      (p) => p.fetch_status !== 'ok' && p.fetch_status !== 'robots_disallowed',
    ).length;
    deps.onProgress?.(`${ok} page(s) fetched${failed ? `, ${failed} failed` : ''}`);
  };

  // ---- 2. homepage ---------------------------------------------------------------------
  if (!robots.isAllowed(start)) {
    record(start, 0, 0, {
      failure: new FetchFailure('robots_disallowed', 'robots.txt disallows this page.'),
    });
    limitations.push(
      'robots.txt disallows crawling the company homepage, so no company pages were read.',
    );
    return {
      startUrl: start.toString(),
      homeUrl: start.toString(),
      homepage: null,
      robots: robotsStatus,
      pages,
      limitations,
    };
  }

  let home: URL;
  let homepage: ExtractedPage;
  let truncated = 0;
  try {
    await pacing.take();
    const response = await deps.http.get(start.toString(), request('html'));
    home = new URL(response.url);
    homepage = extractPage(response.body, response.url);
    if (response.truncated) truncated++;
  } catch (error) {
    if (!isFetchFailure(error)) throw error;
    if (error.status === 'blocked_url') {
      throw new AppError('URL_NOT_ALLOWED', error.message, { status: 400 });
    }
    throw new AppError(
      'COMPANY_UNREACHABLE',
      `The company homepage ${start.toString()} could not be fetched (${summarizeFailure(error)}).`,
      { retryable: error.retryable || error.status === 'network_error', status: 422 },
    );
  }
  record(home, 0, 0, { page: homepage, isHome: true });
  report();

  // ---- 3/4. best-first bounded crawl ---------------------------------------------------
  const visited = new Set([canonicalUrl(start), canonicalUrl(home)]);
  const frontier = new Map<string, Candidate>();
  let order = 0;
  let disallowed = 0;

  const onSite = (url: URL) => isSameSite(url, home) || isSameSite(url, start);

  const addLinks = (links: ExtractedLink[], depth: number) => {
    if (depth > options.maxDepth) return;
    for (const link of links) {
      if (!onSite(link.url) || isExcludedResource(link.url)) continue;
      const key = canonicalUrl(link.url);
      if (visited.has(key)) continue;
      const { score } = scoreLink(link, depth);
      if (score <= 0) continue;
      const existing = frontier.get(key);
      if (existing && existing.score >= score) continue;
      frontier.set(key, {
        // fetch the URL as linked; the canonical form is only a de-duplication key, and
        // changing it (e.g. dropping a trailing slash) would break relative links on that page
        url: link.url,
        depth,
        score,
        order: existing?.order ?? order++,
      });
    }
  };

  const takeBest = (count: number): Candidate[] => {
    const ranked = [...frontier.entries()].sort(
      ([, a], [, b]) => b.score - a.score || a.order - b.order,
    );
    const chosen: Candidate[] = [];
    for (const [key, candidate] of ranked) {
      if (chosen.length >= count) break;
      frontier.delete(key);
      visited.add(key);
      if (!robots.isAllowed(candidate.url)) {
        disallowed++;
        record(candidate.url, candidate.depth, candidate.score, {
          failure: new FetchFailure('robots_disallowed', 'robots.txt disallows this page.'),
        });
        continue;
      }
      chosen.push(candidate);
    }
    return chosen;
  };

  const fetchCandidate = async (candidate: Candidate) => {
    try {
      await pacing.take();
      const response = await deps.http.get(candidate.url.toString(), request('html'));
      const finalUrl = new URL(response.url);
      if (!onSite(finalUrl)) {
        throw new FetchFailure('redirect_error', 'The page redirected to another website.');
      }
      const finalKey = canonicalUrl(finalUrl);
      if (finalKey !== canonicalUrl(candidate.url)) {
        if (visited.has(finalKey)) return; // redirected to a page we already have
        visited.add(finalKey);
      }
      const page = extractPage(response.body, response.url);
      if (response.truncated) truncated++;
      record(finalUrl, candidate.depth, candidate.score, { page, isHome: false });
      addLinks(page.links, candidate.depth + 1);
    } catch (error) {
      if (!isFetchFailure(error)) throw error;
      record(candidate.url, candidate.depth, candidate.score, { failure: error });
    } finally {
      report();
    }
  };

  addLinks(homepage.links, 1);
  let attempts = 1; // the homepage
  while (attempts < options.maxPages) {
    if (deps.signal?.aborted) throw deps.signal.reason;
    const batch = takeBest(Math.min(options.maxConcurrency, options.maxPages - attempts));
    if (batch.length === 0) {
      if (frontier.size === 0) break;
      continue; // everything taken was disallowed; try the next best links
    }
    attempts += batch.length;
    await Promise.all(batch.map(fetchCandidate));
  }

  // ---- honest gaps ---------------------------------------------------------------------
  const ok = pages.filter((p) => p.fetch_status === 'ok');
  const failed = pages.filter(
    (p) => p.fetch_status !== 'ok' && p.fetch_status !== 'robots_disallowed',
  );
  if (!ok.some((p) => p.source_type === 'careers' || p.source_type === 'interview')) {
    limitations.push('No careers, jobs or hiring page was found on the company website.');
  }
  if (!ok.some((p) => p.source_type === 'about')) {
    limitations.push('No about or company page was found on the company website.');
  }
  if (failed.length > 0) {
    const reasons = [...new Set(failed.map((p) => describeFailure(p.fetch_status, p.http_status)))];
    limitations.push(`${failed.length} page(s) could not be fetched (${reasons.join(', ')}).`);
  }
  if (truncated > 0) {
    limitations.push(
      `${truncated} page(s) were larger than ${options.maxPageBytes} bytes; only the first ${options.maxPageBytes} bytes were read.`,
    );
  }
  if (disallowed > 0) {
    limitations.push(`robots.txt disallowed ${disallowed} relevant page(s), which were skipped.`);
  }
  if (frontier.size > 0) {
    limitations.push(
      `The ${options.maxPages}-page limit was reached; ${frontier.size} lower-ranked link(s) were not fetched.`,
    );
  }

  return {
    startUrl: start.toString(),
    homeUrl: home.toString(),
    homepage: {
      title: homepage.title,
      siteName: homepage.siteName,
      description: homepage.description,
    },
    robots: robotsStatus,
    pages,
    limitations,
  };
}
