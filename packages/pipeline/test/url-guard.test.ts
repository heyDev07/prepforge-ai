import { describe, expect, it } from 'vitest';
import { assertUrlAllowed, isBlockedIp, parseHttpUrl, type LookupFn } from '../src/net/url-guard';
import { FetchFailure } from '../src/net/errors';

const strict = { allowPrivateNetwork: false };
const permissive = { allowPrivateNetwork: true };
const resolvesTo =
  (...addresses: string[]): LookupFn =>
  async () =>
    addresses;

async function statusOf(
  raw: string,
  lookup: LookupFn = resolvesTo('93.184.216.34'),
  policy = strict,
) {
  try {
    await assertUrlAllowed(parseHttpUrl(raw), policy, lookup);
    return 'allowed';
  } catch (error) {
    return (error as FetchFailure).status;
  }
}

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '127.8.9.10',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd00:ec2::254',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public address %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );
});

describe('parseHttpUrl', () => {
  it.each(['ftp://acme.example', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url'])(
    'rejects %s',
    (raw) => {
      expect(() => parseHttpUrl(raw)).toThrow(FetchFailure);
    },
  );

  it('rejects embedded credentials', () => {
    expect(() => parseHttpUrl('https://user:pass@acme.example')).toThrow(/credentials/);
  });
});

describe('assertUrlAllowed (production policy)', () => {
  it('allows a public hostname', async () => {
    expect(await statusOf('https://acme.example/careers')).toBe('allowed');
  });

  it.each([
    'http://localhost:3000',
    'http://api.localhost',
    'http://metadata.google.internal',
    'http://127.0.0.1',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'http://[::ffff:127.0.0.1]/',
  ])('blocks %s', async (raw) => {
    expect(await statusOf(raw)).toBe('blocked_url');
  });

  it('blocks hostnames that resolve to a private address', async () => {
    expect(await statusOf('https://evil.example', resolvesTo('10.0.0.5'))).toBe('blocked_url');
  });

  it('blocks when ANY resolved address is private', async () => {
    expect(await statusOf('https://evil.example', resolvesTo('93.184.216.34', '127.0.0.1'))).toBe(
      'blocked_url',
    );
  });

  it('reports unresolvable hosts as network errors', async () => {
    const failing: LookupFn = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await statusOf('https://nope.example', failing)).toBe('network_error');
  });
});

describe('assertUrlAllowed (evaluator policy)', () => {
  it('allows localhost test servers when private networks are permitted', async () => {
    expect(await statusOf('http://localhost:4010/', resolvesTo('127.0.0.1'), permissive)).toBe(
      'allowed',
    );
    expect(await statusOf('http://127.0.0.1:4010/', resolvesTo(), permissive)).toBe('allowed');
  });
});
