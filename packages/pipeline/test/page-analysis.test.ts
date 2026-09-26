import { describe, expect, it } from 'vitest';
import { classifyPage } from '../src/research/classify-page';
import { deriveCompanyName } from '../src/research/company-name';
import { extractPage } from '../src/research/extract-content';
import { isExcludedResource, scoreLink } from '../src/research/link-ranker';
import { siteSection } from '../src/research/crawler';
import { canonicalUrl, isSameSite, registrableDomain, subdomainTokens } from '../src/research/site';

describe('site helpers', () => {
  it.each([
    ['acme.com', 'acme.com'],
    ['careers.acme.com', 'acme.com'],
    ['a.b.acme.io', 'acme.io'],
    ['www.acme.co.uk', 'acme.co.uk'],
    ['localhost', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
  ])('registrableDomain(%s) = %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });

  it('treats subdomains as the same site but not other domains', () => {
    const home = new URL('https://www.acme.com/');
    expect(isSameSite(home, new URL('https://careers.acme.com/jobs'))).toBe(true);
    expect(isSameSite(home, new URL('https://acme.io/'))).toBe(false);
    expect(isSameSite(home, new URL('https://notacme.com/'))).toBe(false);
  });

  it('requires an exact host and port match for localhost', () => {
    const home = new URL('http://localhost:4010/');
    expect(isSameSite(home, new URL('http://localhost:4010/about'))).toBe(true);
    expect(isSameSite(home, new URL('http://localhost:4011/about'))).toBe(false);
  });

  it('canonicalises URLs for de-duplication', () => {
    expect(canonicalUrl('https://acme.com/careers/?utm_source=x&b=2&a=1#top')).toBe(
      'https://acme.com/careers?a=1&b=2',
    );
    expect(canonicalUrl('https://acme.com/')).toBe('https://acme.com/');
  });
});

describe('subdomainTokens and siteSection', () => {
  it('reads the labels in front of the registrable domain, ignoring www', () => {
    expect(subdomainTokens('careers.microsoft.com')).toEqual(['careers']);
    expect(subdomainTokens('jobs.eu.acme.co.uk')).toEqual(['jobs', 'eu']);
    expect(subdomainTokens('www.acme.com')).toEqual([]);
    expect(subdomainTokens('acme.com')).toEqual([]);
    expect(subdomainTokens('localhost')).toEqual([]);
  });

  it('groups pages by host and first non-locale path segment', () => {
    const section = (url: string) => siteSection(new URL(url));
    expect(section('https://www.microsoft.com/en-in/microsoft-teams/premium')).toBe(
      'www.microsoft.com/microsoft-teams',
    );
    expect(section('https://www.microsoft.com/en-us/microsoft-teams/education')).toBe(
      'www.microsoft.com/microsoft-teams',
    );
    expect(section('https://acme.com/careers/backend')).toBe('acme.com/careers');
    expect(section('https://acme.com/')).toBe('acme.com/');
  });
});

describe('extractPage', () => {
  const html = `<!doctype html><html><head>
    <title>Careers | Acme Robotics</title>
    <meta property="og:site_name" content="Acme Robotics">
    <meta name="description" content="Warehouse robots">
    <base href="/sub/">
  </head><body>
    <nav><a href="/about">About</a><a href="login">Log in</a></nav>
    <main><h1>Join our team</h1><p>We build robots.</p><p>Engineers  own   services.</p>
      <script>alert('x')</script><style>p{}</style>
      <a href="../careers/backend#apply" title="Backend role">Backend Engineer</a>
      <a href="mailto:jobs@acme.com">Email</a><a href="javascript:void(0)">JS</a><a href="#top">Top</a>
      <a href="//offsite.example/x">Offsite</a>
    </main>
    <footer>© Acme <a href="/privacy">Privacy</a></footer>
  </body></html>`;
  const page = extractPage(html, 'https://acme.com/careers');

  it('reads metadata', () => {
    expect(page).toMatchObject({
      title: 'Careers | Acme Robotics',
      h1: 'Join our team',
      siteName: 'Acme Robotics',
      description: 'Warehouse robots',
    });
  });

  it('keeps visible text line by line and drops scripts, styles, nav and footer', () => {
    expect(page.text).toBe(
      'Join our team\nWe build robots.\nEngineers own services.\nBackend Engineer\nEmail JS Top\nOffsite',
    );
    expect(page.text).not.toContain('alert');
    expect(page.text).not.toContain('Privacy');
  });

  it('resolves relative links against <base href> and drops non-http links and fragments', () => {
    const urls = page.links.map((link) => link.url.toString());
    expect(urls).toEqual([
      'https://acme.com/about',
      'https://acme.com/sub/login',
      'https://acme.com/careers/backend',
      'https://offsite.example/x',
      'https://acme.com/privacy',
    ]);
    expect(page.links[2]).toMatchObject({ text: 'Backend Engineer', title: 'Backend role' });
  });
});

describe('scoreLink', () => {
  const score = (path: string, text = '', depth = 1) =>
    scoreLink({ url: new URL(`https://acme.com${path}`), text, title: '' }, depth).score;

  it('ranks careers and interview pages above generic pages', () => {
    expect(score('/careers', 'Careers')).toBeGreaterThan(score('/about', 'About us'));
    expect(score('/about', 'About us')).toBeGreaterThan(score('/blog', 'Blog'));
    expect(score('/engineering/how-we-interview')).toBeGreaterThan(score('/engineering'));
  });

  it('uses anchor text when the path says nothing', () => {
    expect(score('/p/123', "We're hiring!")).toBeGreaterThan(0);
    expect(score('/p/123', 'Read more')).toBeLessThanOrEqual(0);
  });

  it('recognises multi-word paths such as work-with-us', () => {
    expect(
      scoreLink({ url: new URL('https://acme.com/work-with-us'), text: '', title: '' }, 1).matched,
    ).toContain('workwithus');
  });

  it('penalises login, privacy and legal pages below zero', () => {
    expect(score('/login', 'Log in')).toBeLessThan(0);
    expect(score('/privacy', 'Privacy policy')).toBeLessThan(0);
    expect(score('/legal/terms')).toBeLessThan(0);
  });

  it('penalises depth and query strings', () => {
    expect(score('/careers', '', 1)).toBeGreaterThan(score('/careers', '', 2));
    expect(score('/careers')).toBeGreaterThan(score('/careers?page=2'));
  });

  it('reads keywords from the subdomain as well as the path', () => {
    const at = (url: string, text = '') =>
      scoreLink({ url: new URL(url), text, title: '' }, 1).score;
    expect(at('https://careers.acme.com/', 'Careers')).toBe(
      at('https://acme.com/careers', 'Careers'),
    );
    expect(at('https://accounts.acme.com/signin')).toBeLessThan(0);
  });

  it('does not treat a product called "Teams" as a team page', () => {
    expect(score('/microsoft-teams/premium', 'Microsoft Teams')).toBeLessThanOrEqual(0);
    expect(score('/our-team', 'Meet the team')).toBeGreaterThan(0);
  });

  it('excludes downloads and assets', () => {
    expect(isExcludedResource(new URL('https://acme.com/handbook.pdf'))).toBe(true);
    expect(isExcludedResource(new URL('https://acme.com/handbook'))).toBe(false);
  });
});

describe('classifyPage', () => {
  const classify = (path: string, title = '', h1 = '') =>
    classifyPage({ url: new URL(`https://acme.com${path}`), title, h1 }, false);

  it.each([
    ['/engineering/how-we-interview', 'interview'],
    ['/careers', 'careers'],
    ['/join-our-team', 'careers'],
    ['/work-with-us', 'careers'],
    ['/engineering', 'engineering'],
    ['/culture', 'culture'],
    ['/about', 'about'],
    ['/company/team', 'about'],
    ['/pricing', 'other'],
    ['/microsoft-teams/premium', 'other'],
  ])('%s → %s', (path, expected) => {
    expect(classify(path)).toBe(expected);
  });

  it('classifies a careers subdomain as careers', () => {
    const page = { url: new URL('https://careers.acme.com/v2/home.html'), title: '', h1: '' };
    expect(classifyPage(page, false)).toBe('careers');
  });

  it('falls back to the title when the path is opaque', () => {
    expect(classify('/p/42', 'Open positions at Acme')).toBe('careers');
  });

  it('labels the start page as homepage', () => {
    expect(classifyPage({ url: new URL('https://acme.com/'), title: '', h1: '' }, true)).toBe(
      'homepage',
    );
  });
});

describe('deriveCompanyName', () => {
  const url = new URL('https://www.acme-robotics.com/');

  it('prefers the name stated in the JD, then og:site_name', () => {
    expect(deriveCompanyName({ jdCompany: 'Acme Inc.', siteName: 'ACME', url })).toBe('Acme Inc.');
    expect(deriveCompanyName({ siteName: 'Acme Robotics', url })).toBe('Acme Robotics');
  });

  it('picks the title segment that matches the domain', () => {
    expect(
      deriveCompanyName({ homepageTitle: 'Warehouse automation made simple | Acme Robotics', url }),
    ).toBe('Acme Robotics');
  });

  it('falls back to the domain label', () => {
    expect(deriveCompanyName({ homepageTitle: 'Home', url })).toBe('Acme Robotics');
  });

  it('uses the first short title segment for localhost sites', () => {
    const local = new URL('http://localhost:4010/');
    expect(
      deriveCompanyName({ homepageTitle: 'Globex — Payments infrastructure', url: local }),
    ).toBe('Globex');
  });
});
