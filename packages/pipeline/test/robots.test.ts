import { describe, expect, it } from 'vitest';
import { parseRobots, productToken } from '../src/research/robots';

const UA = 'PrepForgeBot/1.0 (+https://github.com/heyDev07/prepforge-ai)';
const allowed = (robots: string, path: string, ua = UA) =>
  parseRobots(robots, ua).isAllowed(`https://acme.example${path}`);

describe('robots.txt', () => {
  it('extracts the product token from a user agent', () => {
    expect(productToken(UA)).toBe('prepforgebot');
  });

  it('allows everything when the file is empty', () => {
    expect(allowed('', '/careers')).toBe(true);
  });

  it('applies the wildcard group', () => {
    const robots = 'User-agent: *\nDisallow: /careers\n';
    expect(allowed(robots, '/careers')).toBe(false);
    expect(allowed(robots, '/careers/backend')).toBe(false);
    expect(allowed(robots, '/about')).toBe(true);
  });

  it('prefers a group that names our bot over the wildcard group', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: PrepForgeBot',
      'Disallow: /careers',
    ].join('\n');
    expect(allowed(robots, '/about')).toBe(true);
    expect(allowed(robots, '/careers')).toBe(false);
    expect(allowed(robots, '/about', 'OtherBot/2.0')).toBe(false);
  });

  it('combines consecutive user-agent lines into one group', () => {
    const robots = 'User-agent: googlebot\nUser-agent: prepforgebot\nDisallow: /private\n';
    expect(allowed(robots, '/private/x')).toBe(false);
  });

  it('uses the longest match, with Allow winning ties', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /company',
      'Allow: /company/careers',
      'Disallow: /tie',
      'Allow: /tie',
    ].join('\n');
    expect(allowed(robots, '/company/team')).toBe(false);
    expect(allowed(robots, '/company/careers/eng')).toBe(true);
    expect(allowed(robots, '/tie')).toBe(true);
  });

  it('supports * wildcards and $ anchors', () => {
    const robots = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?session=\n';
    expect(allowed(robots, '/handbook.pdf')).toBe(false);
    expect(allowed(robots, '/handbook.pdf.html')).toBe(true);
    expect(allowed(robots, '/jobs?session=abc')).toBe(false);
    expect(allowed(robots, '/jobs?team=eng')).toBe(true);
  });

  it('treats an empty Disallow as allow-all', () => {
    expect(allowed('User-agent: *\nDisallow:\n', '/anything')).toBe(true);
  });

  it('ignores comments, unknown fields and rules before any user-agent', () => {
    const robots =
      'Disallow: /early\n# comment\nUser-agent: * # everyone\nNoindex: /x\nDisallow: /late # trailing\n';
    expect(allowed(robots, '/early')).toBe(true);
    expect(allowed(robots, '/late')).toBe(false);
  });

  it('always allows robots.txt itself', () => {
    expect(allowed('User-agent: *\nDisallow: /\n', '/robots.txt')).toBe(true);
  });

  it('reads crawl-delay and sitemaps', () => {
    const rules = parseRobots(
      'Sitemap: https://acme.example/sitemap.xml\nUser-agent: *\nCrawl-delay: 1.5\n',
      UA,
    );
    expect(rules.crawlDelayMs).toBe(1_500);
    expect(rules.sitemaps).toEqual(['https://acme.example/sitemap.xml']);
  });

  it('handles Windows line endings and percent-encoding', () => {
    const robots = 'User-agent: *\r\nDisallow: /caf%C3%A9\r\n';
    expect(allowed(robots, '/café')).toBe(false);
  });
});
