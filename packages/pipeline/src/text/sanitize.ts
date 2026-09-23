/** Text hygiene for untrusted content (web pages, search snippets, job descriptions). */

/**
 * Control characters (except tab/newline), zero-width characters, bidirectional overrides and
 * the byte-order mark. These can hide or reorder text and have no place in model prompts.
 */
/* eslint-disable no-control-regex -- matching control characters is the point */
const INVISIBLE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
/* eslint-enable no-control-regex */

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '');
}

/** Collapses all whitespace runs (including newlines) to single spaces. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Truncates to at most maxChars characters, marking the cut with an ellipsis. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
