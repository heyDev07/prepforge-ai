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

/** Lower-cased word tokens of free text. */
export function textTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
