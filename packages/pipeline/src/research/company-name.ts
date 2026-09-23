import { isIP } from 'node:net';
import { registrableDomain } from './site';

const TITLE_SEPARATORS = /\s+[|–—:·•-]\s+/;
const GENERIC_SEGMENTS = /^(home|homepage|welcome|careers?|jobs|about( us)?|official site)$/i;

function alnum(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titleCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "careers.acme-robotics.co.uk" → "acme-robotics"; returns null for IPs and localhost. */
export function domainLabel(url: URL): string | null {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || !host.includes('.')) return null;
  return registrableDomain(host).split('.')[0] ?? null;
}

/**
 * Deterministic company-name fallback chain:
 *   1. name stated in the JD
 *   2. og:site_name of the homepage
 *   3. the homepage <title> segment that matches the domain (or the first short segment)
 *   4. the domain label
 */
export function deriveCompanyName(input: {
  jdCompany?: string | null;
  siteName?: string | null;
  homepageTitle?: string | null;
  url: URL;
}): string {
  const fromJd = input.jdCompany?.trim();
  if (fromJd) return fromJd;
  const siteName = input.siteName?.trim();
  if (siteName) return siteName;

  const label = domainLabel(input.url);
  const segments = (input.homepageTitle ?? '')
    .split(TITLE_SEPARATORS)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !GENERIC_SEGMENTS.test(segment));

  if (label) {
    const target = alnum(label);
    const matching = segments.find((segment) => {
      const key = alnum(segment);
      return key.length > 0 && (key.includes(target) || target.includes(key));
    });
    if (matching) return matching;
  }
  const short = segments.find((segment) => segment.split(/\s+/).length <= 4);
  if (short) return short;
  if (label) return label.split('-').map(titleCase).join(' ');
  return input.url.host;
}
