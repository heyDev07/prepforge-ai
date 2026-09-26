import { AppError } from '@prepforge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpClient } from '../src/net/http-client';
import { crawlCompanySite, type CrawlOptions } from '../src/research/crawler';
import { startMockSites, type MockSitesHandle } from '../src/testing';
import { unusedLocalUrl } from './support/http-server';

const options: CrawlOptions = {
  maxPages: 12,
  maxDepth: 2,
  maxConcurrency: 2,
  requestTimeoutMs: 1_000,
  maxPageBytes: 200_000,
  maxRetries: 2,
  userAgent: 'PrepForgeBot/1.0 (+test)',
  policy: { allowPrivateNetwork: true },
  minDelayMs: 0,
};

// Retries wait for real, but with a tiny base so the suite stays fast.
const http = new HttpClient({ sleep: async () => undefined });

let sites: MockSitesHandle;
beforeAll(async () => {
  sites = await startMockSites();
});
afterAll(() => sites.close());

/** Paths of crawled pages, ignoring trailing slashes ("/careers/" → "/careers"). */
const paths = (pages: { url: string }[]) =>
  pages.map((p) => new URL(p.url).pathname.replace(/(.)\/$/, '$1'));

describe('crawlCompanySite', () => {
  it('discovers careers, about and interview pages by ranking links', async () => {
    const result = await crawlCompanySite(sites.urls['acme-careers'], options, { http });
    const ok = result.pages.filter((p) => p.fetch_status === 'ok');

    expect(result.homepage?.siteName).toBe('Acme Robotics');
    expect(ok[0]).toMatchObject({ source_type: 'homepage', depth: 0 });
    expect(paths(ok)).toEqual(
      expect.arrayContaining([
        '/careers',
        '/about',
        '/engineering/how-we-interview',
        '/careers/senior-backend-engineer',
      ]),
    );
    const types = ok.map((p) => p.source_type);
    expect(types).toEqual(
      expect.arrayContaining(['homepage', 'careers', 'about', 'interview', 'engineering']),
    );
    // low-value and negative links are never fetched
    expect(paths(result.pages)).not.toContain('/privacy');
    expect(paths(result.pages)).not.toContain('/login');
    expect(paths(result.pages)).not.toContain('/product');
    expect(result.limitations).toEqual([]);
  });

  it('fetches the highest-ranked link first', async () => {
    const result = await crawlCompanySite(
      sites.urls['acme-careers'],
      { ...options, maxConcurrency: 1 },
      { http },
    );
    expect(new URL(result.pages[1]!.url).pathname).toBe('/careers');
  });

  it('reports honest gaps for a site without a careers page', async () => {
    const result = await crawlCompanySite(sites.urls['no-careers'], options, { http });
    expect(result.robots).toBe('missing');
    expect(paths(result.pages)).toEqual(['/', '/about']);
    expect(result.limitations).toContain(
      'No careers, jobs or hiring page was found on the company website.',
    );
  });

  it('finds a nested hiring page within MAX_DEPTH but never goes deeper', async () => {
    const result = await crawlCompanySite(sites.urls['nested-hiring'], options, { http });
    const fetched = paths(result.pages);
    expect(fetched).toContain('/company/join-us');
    expect(fetched).toContain('/company/team');
    expect(fetched).not.toContain('/company/team/open-roles');
    expect(Math.max(...result.pages.map((p) => p.depth))).toBeLessThanOrEqual(2);

    const deeper = await crawlCompanySite(
      sites.urls['nested-hiring'],
      { ...options, maxDepth: 3 },
      { http },
    );
    expect(paths(deeper.pages)).toContain('/company/team/open-roles');
  });

  it('respects MAX_PAGES', async () => {
    const result = await crawlCompanySite(
      sites.urls['acme-careers'],
      { ...options, maxPages: 3 },
      { http },
    );
    expect(result.pages).toHaveLength(3);
    expect(result.limitations.some((l) => l.includes('3-page limit'))).toBe(true);
  });

  it('records broken pages and keeps going', async () => {
    const result = await crawlCompanySite(
      sites.urls.broken,
      { ...options, requestTimeoutMs: 300, maxPageBytes: 100_000 },
      { http },
    );
    const byPath = Object.fromEntries(result.pages.map((p) => [new URL(p.url).pathname, p]));

    expect(byPath['/about']).toMatchObject({ fetch_status: 'ok' }); // succeeded after two 503s
    expect(sites.hits.broken.get('/about')).toBe(3);
    expect(byPath['/careers']).toMatchObject({ fetch_status: 'http_error', http_status: 500 });
    expect(byPath['/jobs']).toMatchObject({ fetch_status: 'http_error', http_status: 404 });
    expect(byPath['/culture']).toMatchObject({ fetch_status: 'timeout' });
    // oversized HTML is read up to the cap instead of being dropped
    expect(byPath['/handbook']).toMatchObject({ fetch_status: 'ok', source_type: 'culture' });
    expect(byPath['/engineering']).toMatchObject({ fetch_status: 'bad_content_type' });
    expect(byPath['/team']).toMatchObject({ fetch_status: 'redirect_error' });
    // the careers pages failed and no other careers page was read, so that is named
    const careers = result.limitations.find((l) => l.startsWith('The careers page could not'));
    expect(careers).toContain('/careers (HTTP 500)');
    expect(careers).toContain('/jobs (HTTP 404)');
    // 5 of 8 pages failed, so the site as a whole is reported; each reason is the real one
    const most = result.limitations.find((l) => l.startsWith('Most pages'));
    expect(most).toContain('5 of 8');
    for (const reason of [
      'HTTP 500',
      'HTTP 404',
      'timeout',
      'bad content type',
      'redirect error',
    ]) {
      expect(most).toContain(reason);
    }
    expect(most).not.toContain('HTTP 200');
    expect(result.limitations).toContain(
      '1 page(s) were larger than 100000 bytes; only the first 100000 bytes were read.',
    );
  });

  it('reads an oversized homepage up to the byte cap instead of failing', async () => {
    const result = await crawlCompanySite(
      new URL('/handbook', sites.urls.broken).toString(),
      { ...options, maxPages: 1, maxPageBytes: 50_000 },
      { http },
    );
    expect(result.pages[0]).toMatchObject({ fetch_status: 'ok', depth: 0 });
    expect(result.homepage?.title).toBe('Employee handbook');
    expect(result.pages[0]!.text).toContain('How we plan, review and ship work');
    expect(result.limitations).toContain(
      '1 page(s) were larger than 50000 bytes; only the first 50000 bytes were read.',
    );
  });

  it('guesses well-known paths when the homepage links reveal no careers or about page', async () => {
    // the oversized page has no links at all, like a homepage whose footer was cut off
    const result = await crawlCompanySite(
      new URL('/handbook', sites.urls.broken).toString(),
      // the homepage plus the three guesses; /about's own (broken) links are not followed
      { ...options, maxPages: 4, maxPageBytes: 50_000 },
      { http },
    );
    const byPath = Object.fromEntries(result.pages.map((p) => [new URL(p.url).pathname, p]));
    expect(byPath['/about']).toMatchObject({ fetch_status: 'ok', source_type: 'about', depth: 1 });
    // /careers (HTTP 500) and /jobs (404) were only guesses, so they are not logged as broken
    expect(byPath['/careers']).toBeUndefined();
    expect(byPath['/jobs']).toBeUndefined();
    expect(result.limitations.some((l) => l.includes('could not be fetched'))).toBe(false);
    expect(result.limitations).toContain(
      'No careers, jobs or hiring page was found on the company website.',
    );
  });

  it('does not guess paths when the homepage already links to careers and about pages', async () => {
    await crawlCompanySite(sites.urls['acme-careers'], options, { http });
    expect(sites.hits['acme-careers'].get('/jobs')).toBeUndefined();
  });

  it('resolves relative links and stays on the company site', async () => {
    const result = await crawlCompanySite(sites.urls['relative-links'], options, { http });
    const fetched = paths(result.pages);
    expect(fetched).toEqual(
      expect.arrayContaining([
        '/about',
        '/careers',
        '/jobs',
        '/team',
        '/careers/engineering-roles',
      ]),
    );
    expect(
      result.pages.every((p) => new URL(p.url).host === new URL(sites.urls['relative-links']).host),
    ).toBe(true);
  });

  it('obeys the robots.txt group for our user agent', async () => {
    const result = await crawlCompanySite(sites.urls['robots-restricted'], options, { http });
    const byPath = Object.fromEntries(result.pages.map((p) => [new URL(p.url).pathname, p]));
    expect(byPath['/about']?.fetch_status).toBe('ok');
    expect(byPath['/careers']?.fetch_status).toBe('robots_disallowed');
    expect(sites.hits['robots-restricted'].get('/careers')).toBeUndefined();
    expect(result.limitations).toContain(
      'robots.txt disallowed 1 relevant page(s), which were skipped.',
    );
  });

  it('does not crawl anything when robots.txt blocks our bot entirely', async () => {
    const result = await crawlCompanySite(
      sites.urls['robots-restricted'],
      { ...options, userAgent: 'SomeOtherBot/1.0' },
      { http },
    );
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.fetch_status).toBe('robots_disallowed');
    expect(result.homepage).toBeNull();
  });

  it('keeps injected instructions as plain page text', async () => {
    const result = await crawlCompanySite(sites.urls.injection, options, { http });
    const about = result.pages.find((p) => p.url.endsWith('/about'));
    expect(about?.text).toContain('Ignore all previous instructions');
  });

  it('fails with COMPANY_UNREACHABLE when nothing is listening', async () => {
    const url = await unusedLocalUrl();
    await expect(
      crawlCompanySite(url, { ...options, maxRetries: 0 }, { http }),
    ).rejects.toMatchObject({
      code: 'COMPANY_UNREACHABLE',
    });
  });

  it('refuses private addresses under the production policy', async () => {
    const error = await crawlCompanySite(
      sites.urls['acme-careers'],
      { ...options, policy: { allowPrivateNetwork: false } },
      { http },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('URL_NOT_ALLOWED');
  });
});
