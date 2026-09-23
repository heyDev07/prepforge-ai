/**
 * robots.txt parsing and matching (RFC 9309).
 *
 * - Groups start with one or more `User-agent` lines. The group(s) naming our product token
 *   win; otherwise the `*` group(s) apply. Only one set of groups is ever used.
 * - Allow/Disallow patterns support `*` wildcards and a trailing `$` anchor.
 * - The longest matching pattern wins; on a tie, Allow wins.
 * - Crawl-delay (non-standard but common) and Sitemap lines are also read.
 */

export interface RobotsRules {
  isAllowed(url: URL | string): boolean;
  /** Requested delay between requests, if any. */
  crawlDelayMs: number | null;
  sitemaps: string[];
}

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelayMs: number | null;
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true, crawlDelayMs: null, sitemaps: [] };
export const DISALLOW_ALL: RobotsRules = {
  isAllowed: () => false,
  crawlDelayMs: null,
  sitemaps: [],
};

/** "PrepForgeBot/1.0 (+https://…)" → "prepforgebot" */
export function productToken(userAgent: string): string {
  return (userAgent.split(/[/\s]/)[0] ?? '').toLowerCase();
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/** Normalises percent-encoding so /caf%C3%A9 and /café compare equal. */
function normalizePath(path: string): string {
  try {
    return encodeURI(decodeURI(path));
  } catch {
    return path;
  }
}

function parseGroups(text: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelayMs: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue; // rules before any user-agent line are ignored

    if (field === 'allow' || field === 'disallow') {
      if (!value) continue; // an empty Disallow means "allow everything" → no rule
      const pattern = normalizePath(
        value.startsWith('/') || value.startsWith('*') ? value : `/${value}`,
      );
      current.rules.push({ allow: field === 'allow', pattern, regex: patternToRegex(pattern) });
    } else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0)
        current.crawlDelayMs = Math.round(seconds * 1000);
    }
  }
  return { groups, sitemaps };
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const { groups, sitemaps } = parseGroups(text);
  const token = productToken(userAgent);

  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== '*' && token.length > 0 && token.includes(agent)),
  );
  const selected = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = selected.flatMap((group) => group.rules);
  const delays = selected.map((g) => g.crawlDelayMs).filter((d): d is number => d !== null);

  return {
    crawlDelayMs: delays.length > 0 ? Math.max(...delays) : null,
    sitemaps,
    isAllowed(input) {
      const url = typeof input === 'string' ? new URL(input) : input;
      const path = normalizePath(`${url.pathname}${url.search}`);
      if (path === '/robots.txt') return true;
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}
