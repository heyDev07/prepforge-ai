/** URL helpers used to keep the crawler on the company's own site. */
import { isIP } from 'node:net';

const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);
const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i;

/**
 * Approximates the registrable domain ("eTLD+1") without a public-suffix list:
 * careers.acme.com → acme.com, www.acme.co.uk → acme.co.uk. IPs and single-label hosts
 * (localhost) are returned unchanged.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  if (isIP(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const tld = labels.at(-1)!;
  const sld = labels.at(-2)!;
  const take = tld.length === 2 && SECOND_LEVEL_LABELS.has(sld) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** Same registrable domain (subdomains allowed). IPs/localhost must match host and port exactly. */
export function isSameSite(a: URL, b: URL): boolean {
  const hostA = a.hostname.replace(/^\[|\]$/g, '');
  const exact = isIP(hostA) || !hostA.includes('.');
  if (exact) return a.host === b.host;
  return registrableDomain(a.hostname) === registrableDomain(b.hostname);
}

/** Canonical form used for de-duplication: no fragment, no tracking params, sorted query, no trailing slash. */
export function canonicalUrl(input: URL | string): string {
  const url = new URL(input.toString());
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

/** Lower-cased alphanumeric tokens of a URL path, e.g. "/Work-With-Us/jobs" → ["work","with","us","jobs"]. */
export function pathTokens(pathname: string): string[] {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // keep the raw path
  }
  return decoded
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Tokens of the subdomain labels in front of the registrable domain, so that
 * careers.acme.com → ["careers"] and jobs.eu.acme.com → ["jobs", "eu"]. "www" is ignored.
 */
export function subdomainTokens(hostname: string): string[] {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const domain = registrableDomain(host);
  if (host === domain || !host.endsWith(`.${domain}`)) return [];
  return host
    .slice(0, -domain.length - 1)
    .split(/[^a-z0-9]+/)
    .filter((label) => label && !/^www\d*$/.test(label));
}

/** Keyword tokens of a URL: its subdomain labels followed by its path. */
export function urlTokens(url: URL): string[] {
  return [...subdomainTokens(url.hostname), ...pathTokens(url.pathname)];
}

/**
 * Whether a keyword stem matches: a token starting with the stem ("career" → "careers"), a long
 * stem inside the joined tokens ("workwithus"), or, for stems ending in "$", an exact token
 * ("team$" matches "team" but not "teams", which is often a product name).
 */
export function matchesStem(tokens: readonly string[], stem: string): boolean {
  if (stem.endsWith('$')) return tokens.includes(stem.slice(0, -1));
  return (
    tokens.some((token) => token.startsWith(stem)) ||
    (stem.length > 6 && tokens.join('').includes(stem))
  );
}

/** Lower-cased word tokens of free text. */
export function textTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
