import * as cheerio from 'cheerio';

/** Converts an HTML fragment (search snippets, HN comments) to plain text. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  const $ = cheerio.load(`<div>${html}</div>`);
  $('p, br').before(' ');
  return $('div').first().text().replace(/\s+/g, ' ').trim();
}
