/**
 * Input fingerprint for duplicate detection and caching:
 *   sha256(normalizedJD + "\n" + normalizedCompanyURL)
 * The newline separator prevents two different inputs from producing the same concatenation.
 * Fingerprints are always used together with a user ID for kits, so kits are never shared.
 */
import { createHash } from 'node:crypto';
import { canonicalUrl } from './research/site';

/** Unicode NFC, unified line endings, trimmed lines, collapsed spaces and blank lines. */
export function normalizeJd(jd: string): string {
  return jd
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Lower-case scheme/host, no default port, fragment, tracking params or trailing slash. */
export function normalizeCompanyUrl(url: string): string {
  const parsed = new URL(url.trim());
  const canonical = canonicalUrl(parsed);
  return canonical.endsWith('/') && parsed.pathname === '/' ? canonical.slice(0, -1) : canonical;
}

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export function computeFingerprint(jd: string, companyUrl: string): string {
  return sha256(`${normalizeJd(jd)}\n${normalizeCompanyUrl(companyUrl)}`);
}

/** Cache keys: extraction depends only on the JD, research only on the URL. */
export const extractionCacheKey = (jd: string) => `extraction:${sha256(normalizeJd(jd))}`;
export const researchCacheKey = (companyUrl: string) =>
  `research:${sha256(normalizeCompanyUrl(companyUrl))}`;
