import { describe, expect, it } from 'vitest';
import {
  computeFingerprint,
  extractionCacheKey,
  normalizeCompanyUrl,
  normalizeJd,
  researchCacheKey,
} from '../src/fingerprint';

describe('normalizeJd', () => {
  it('ignores whitespace-only differences', () => {
    expect(normalizeJd('  Backend   Engineer\r\n\r\n\r\n- Node.js\t and SQL  ')).toBe(
      'Backend Engineer\n- Node.js and SQL',
    );
  });
});

describe('normalizeCompanyUrl', () => {
  it.each([
    ['https://Acme.Example/', 'https://acme.example'],
    ['https://acme.example', 'https://acme.example'],
    ['https://acme.example:443/#top', 'https://acme.example'],
    ['https://acme.example/careers/?utm_source=x', 'https://acme.example/careers'],
    ['http://localhost:4010/', 'http://localhost:4010'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCompanyUrl(input)).toBe(expected);
  });
});

describe('computeFingerprint', () => {
  const jd = 'Backend Engineer\nNode.js and SQL';

  it('is stable across formatting differences', () => {
    expect(computeFingerprint(jd, 'https://acme.example')).toBe(
      computeFingerprint(`  ${jd.replace('\n', '\r\n\r\n')}  `, 'https://ACME.example/'),
    );
  });

  it('changes when the JD or the company changes', () => {
    const base = computeFingerprint(jd, 'https://acme.example');
    expect(computeFingerprint(`${jd} Kafka`, 'https://acme.example')).not.toBe(base);
    expect(computeFingerprint(jd, 'https://globex.example')).not.toBe(base);
  });

  it('is a sha256 hex digest', () => {
    expect(computeFingerprint(jd, 'https://acme.example')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives separate cache keys for extraction and research', () => {
    expect(extractionCacheKey(jd)).toBe(extractionCacheKey(`${jd}  `));
    expect(researchCacheKey('https://acme.example/')).toBe(
      researchCacheKey('https://acme.example'),
    );
    expect(extractionCacheKey(jd)).toMatch(/^extraction:/);
  });
});
