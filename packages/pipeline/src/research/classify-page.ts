import type { SourceType } from '@prepforge/shared';
import { pathTokens, textTokens } from './site';

/** Checked in order; the first rule whose stems match wins. */
const RULES: ReadonlyArray<
  readonly [Exclude<SourceType, 'homepage' | 'public_discussion'>, string[]]
> = [
  ['interview', ['interview']],
  [
    'careers',
    [
      'career',
      'job',
      'hiring',
      'openings',
      'positions',
      'recruit',
      'joinus',
      'workwithus',
      'opportunit',
      'join',
    ],
  ],
  ['engineering', ['engineering', 'tech', 'developer']],
  ['culture', ['culture', 'values', 'handbook', 'lifeat', 'benefits']],
  ['about', ['about', 'company', 'team', 'mission', 'story', 'people', 'leadership']],
];

function match(tokens: string[]): SourceType | null {
  const joined = tokens.join('');
  for (const [type, stems] of RULES) {
    if (
      stems.some(
        (stem) =>
          tokens.some((t) => t.startsWith(stem)) || (stem.length > 6 && joined.includes(stem)),
      )
    ) {
      return type;
    }
  }
  return null;
}

/** Deterministically labels a crawled page from its URL path, falling back to its title/h1. */
export function classifyPage(
  page: { url: URL; title: string; h1: string },
  isHomepage: boolean,
): SourceType {
  if (isHomepage) return 'homepage';
  return (
    match(pathTokens(page.url.pathname)) ?? match(textTokens(`${page.title} ${page.h1}`)) ?? 'other'
  );
}
