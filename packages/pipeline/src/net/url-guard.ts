/**
 * URL validation and SSRF protection.
 *
 * In the default (production) policy every hostname is resolved and ALL returned addresses must
 * be public. Loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT,
 * multicast, reserved and documentation ranges are rejected for IPv4 and IPv6, including
 * IPv4-mapped IPv6. The WHATWG URL parser already normalises decimal/hex/octal IPv4 forms
 * (e.g. http://2130706433/ → 127.0.0.1) before these checks run.
 *
 * The batch evaluator must reach local test servers, so it opts in with allowPrivateNetwork.
 * Every redirect hop is re-checked by the HTTP client.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { FetchFailure } from './errors';

export interface UrlPolicy {
  allowPrivateNetwork: boolean;
}

export type LookupFn = (hostname: string) => Promise<string[]>;

export const systemLookup: LookupFn = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** Extracts the embedded IPv4 address from an IPv4-mapped/compatible IPv6 address, if any. */
function embeddedIpv4(ipv6: string): string | null {
  const lower = ipv6.toLowerCase();
  const dotted = /^(?:0{0,4}:){0,5}(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(
    lower.replace(/^::/, ''),
  );
  if (lower.startsWith('::') && dotted?.[1]) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex?.[1] && hex[2]) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return null;
}

/** True when an IP literal must not be contacted under the production policy. */
export function isBlockedIp(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  const version = isIP(ip);
  if (version === 4) return blocked.check(ip, 'ipv4');
  if (version === 6) {
    const mapped = embeddedIpv4(ip);
    if (mapped) return blocked.check(mapped, 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return true; // not an IP at all — never treat as safe
}

/** Parses and validates an absolute http(s) URL. Throws FetchFailure('blocked_url') on bad input. */
export function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchFailure('blocked_url', 'The URL is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchFailure('blocked_url', 'Only http and https URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new FetchFailure('blocked_url', 'URLs with embedded credentials are not allowed.');
  }
  if (!url.hostname) {
    throw new FetchFailure('blocked_url', 'The URL has no host.');
  }
  return url;
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal');
}

/**
 * Throws FetchFailure unless the URL may be fetched under the policy.
 *  - 'blocked_url'   → policy violation (not retryable)
 *  - 'network_error' → hostname does not resolve
 */
export async function assertUrlAllowed(
  url: URL,
  policy: UrlPolicy,
  lookup: LookupFn = systemLookup,
): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchFailure('blocked_url', 'Only http and https URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new FetchFailure('blocked_url', 'URLs with embedded credentials are not allowed.');
  }
  if (policy.allowPrivateNetwork) return;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isLocalHostname(hostname)) {
    throw new FetchFailure('blocked_url', 'Local and internal hostnames are not allowed.');
  }
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new FetchFailure(
        'blocked_url',
        'Private, loopback and link-local addresses are not allowed.',
      );
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new FetchFailure('network_error', `The host "${hostname}" could not be resolved.`);
  }
  if (addresses.length === 0) {
    throw new FetchFailure('network_error', `The host "${hostname}" could not be resolved.`);
  }
  if (addresses.some(isBlockedIp)) {
    throw new FetchFailure('blocked_url', 'The host resolves to a private or reserved address.');
  }
}
