/**
 * Transparent link scoring. The crawler has no fixed list of paths such as /careers; instead
 * every same-site link is scored from its URL path and anchor text, and only positive scores
 * are followed, best first.
 *
 *   score = Σ path keyword weights + 0.8 · Σ anchor keyword weights
 *           − 2 · depth − 1 (query string) − 1 (more than 4 path segments)
 *           − negative keyword weights
 */
import { matchesStem, pathSegments, pathTokens, textTokens, urlTokens } from './site';

/**
 * Keyword stems (matched as token prefixes) and their weights. Generic words that also appear
 * in product names ("company registration", "Microsoft Teams") match only exactly; see matchesStem.
 */
export const POSITIVE_KEYWORDS: ReadonlyArray<readonly [string, number]> = [
  ['career', 10],
  ['interview', 10],
  ['job', 9],
  ['hiring', 9],
  ['workwithus', 8],
  ['joinus', 8],
  ['openings', 8],
  ['recruit', 8],
  ['about', 8],
  ['engineering', 8],
  ['culture', 7],
  ['join', 7],
  ['handbook', 7],
  ['positions', 7],
  ['opportunit', 7],
  ['company=', 6],
  ['values', 6],
  ['mission', 5],
  ['team$', 5],
  ['people', 4],
  ['story', 4],
  ['tech', 4],
  ['lifeat', 4],
  ['blog', 3],
];

export const NEGATIVE_KEYWORDS: ReadonlyArray<readonly [string, number]> = [
  ['login', 6],
  ['signin', 6],
  ['signup', 6],
  ['register', 6],
  ['logout', 6],
  ['account', 6],
  ['password', 6],
  ['cart', 6],
  ['checkout', 6],
  ['privacy', 6],
  ['terms', 6],
  ['cookie', 6],
  ['legal', 6],
  ['gdpr', 6],
  ['status', 4],
  ['support', 3],
];

const EXCLUDED_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|svg|webp|ico|bmp|css|js|mjs|json|xml|txt|zip|gz|tar|rar|mp4|mp3|mov|avi|webm|woff2?|ttf|eot|dmg|exe|apk|rss|atom|csv|docx?|xlsx?|pptx?)$/i;

const MAX_SIDE_SCORE = 20;

export interface LinkScore {
  score: number;
  matched: string[];
}

function keywordScore(
  tokens: string[],
  segments: string[],
  keywords: ReadonlyArray<readonly [string, number]>,
): { total: number; matched: string[] } {
  let total = 0;
  const matched: string[] = [];
  for (const [stem, weight] of keywords) {
    if (matchesStem(tokens, stem, segments)) {
      total += weight;
      matched.push(stem.replace(/[$=]$/, ''));
    }
  }
  return { total: Math.min(total, MAX_SIDE_SCORE), matched };
}

/** True for links to downloads/assets rather than pages. */
export function isExcludedResource(url: URL): boolean {
  return EXCLUDED_EXTENSIONS.test(url.pathname);
}

export function scoreLink(
  link: { url: URL; text: string; title: string },
  depth: number,
): LinkScore {
  const path = pathTokens(link.url.pathname);
  const anchor = textTokens(`${link.text} ${link.title}`);

  // the subdomain counts like the path: careers.acme.com is as clear as acme.com/careers
  const location = urlTokens(link.url);
  const segments = pathSegments(link.url.pathname);
  // the whole anchor text or title counts as one segment: "Company" yes, "Company Registration" no
  const anchorSegments = [link.text, link.title]
    .map((t) => textTokens(t).join(' '))
    .filter(Boolean);
  const pathPositive = keywordScore(location, segments, POSITIVE_KEYWORDS);
  const anchorPositive = keywordScore(anchor, anchorSegments, POSITIVE_KEYWORDS);
  const pathNegative = keywordScore(location, segments, NEGATIVE_KEYWORDS);
  const anchorNegative = keywordScore(anchor, anchorSegments, NEGATIVE_KEYWORDS);

  let score = pathPositive.total + 0.8 * anchorPositive.total;
  score -= Math.max(pathNegative.total, anchorNegative.total);
  score -= 2 * depth;
  if (link.url.search) score -= 1;
  if (path.length > 4) score -= 1;

  const matched = [...new Set([...pathPositive.matched, ...anchorPositive.matched])];
  return { score: Math.round(score * 10) / 10, matched };
}
