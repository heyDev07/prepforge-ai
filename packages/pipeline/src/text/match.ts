/**
 * Deterministic text matching used to check that model output is supported by its source
 * (e.g. that a requirement's quote really appears in the job description).
 */

const STOPWORDS = new Set(
  (
    'a an and are as at be by for from has have in is it its of on or our the their to we with ' +
    'you your will would should can able using use etc e.g i.e'
  ).split(' '),
);

/** Lower-case and keep only characters meaningful in skills (c++, c#, node.js); the rest become spaces. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .split(' ')
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .join(' ');
}

/**
 * Framing words that restate a requirement without adding facts ("Proficiency in Python" says
 * no more than "Python"). They are ignored when checking that wording is faithful to a source.
 */
const FRAMING_WORDS = new Set(
  (
    'ability able abilities background competence competency deep demonstrated demonstrable ' +
    'excellent experience experienced expertise familiarity familiar good great hands knowledge ' +
    'knowing know proficiency proficient skill skills skilled solid strong understanding working ' +
    'proven track record level advanced basic'
  ).split(' '),
);

export function contentTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(' ')
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

/** Pre-computed view of a source document for repeated matching. */
export interface MatchIndex {
  normalized: string;
  tokens: Set<string>;
}

export function buildMatchIndex(source: string): MatchIndex {
  const normalized = normalizeForMatch(source);
  return { normalized, tokens: new Set(normalized.split(' ')) };
}

/** Fraction of the text's content tokens that occur in the source (1 when there are none). */
export function tokenCoverage(
  text: string,
  index: MatchIndex,
  options: { ignoreFraming?: boolean } = {},
): number {
  const tokens = contentTokens(text).filter(
    (token) => !options.ignoreFraming || !FRAMING_WORDS.has(token) || index.tokens.has(token),
  );
  if (tokens.length === 0) return 1;
  return tokens.filter((token) => index.tokens.has(token)).length / tokens.length;
}

/**
 * True when the quote is supported by the source: an exact (normalised) substring, or — to
 * tolerate small reformatting such as dropped bullet characters — at least 85% of its
 * content tokens present.
 */
export function isSupportedQuote(quote: string, index: MatchIndex): boolean {
  const normalized = normalizeForMatch(quote);
  if (normalized.length < 2) return false;
  if (` ${index.normalized} `.includes(` ${normalized} `)) return true;
  return contentTokens(quote).length > 0 && tokenCoverage(quote, index) >= 0.85;
}
