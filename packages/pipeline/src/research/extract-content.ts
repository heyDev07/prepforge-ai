/**
 * HTML → clean text + links (Cheerio). Page content is treated as inert data: scripts are
 * removed, nothing is executed, and only visible text is kept.
 */
import * as cheerio from 'cheerio';

export const MAX_PAGE_TEXT_CHARS = 20_000;

export interface ExtractedLink {
  url: URL;
  text: string;
  title: string;
}

export interface ExtractedPage {
  title: string;
  h1: string;
  siteName: string;
  description: string;
  text: string;
  links: ExtractedLink[];
}

const NON_CONTENT =
  'script, style, noscript, template, svg, iframe, canvas, object, embed, form, select, button';
const CHROME =
  'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, div, section, article, tr, dt, dd, blockquote, pre';
const INLINE_SEPARATED = 'a, td, th, label, span, strong, em, b, i';
const SKIP_SCHEMES = /^(mailto|tel|javascript|data|ftp|sms|file):/i;

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeText(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_PAGE_TEXT_CHARS);
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);

  let base: URL;
  try {
    base = new URL($('base[href]').attr('href') ?? pageUrl, pageUrl);
  } catch {
    base = new URL(pageUrl);
  }

  const links: ExtractedLink[] = [];
  $('a[href]').each((_, element) => {
    const href = ($(element).attr('href') ?? '').trim();
    if (!href || href.startsWith('#') || SKIP_SCHEMES.test(href)) return;
    try {
      const url = new URL(href, base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      url.hash = '';
      links.push({
        url,
        text: clean($(element).text()).slice(0, 200),
        title: clean($(element).attr('title') ?? $(element).attr('aria-label') ?? '').slice(0, 200),
      });
    } catch {
      // malformed href — ignore
    }
  });

  const title = clean($('title').first().text());
  const h1 = clean($('h1').first().text());
  const siteName = clean($('meta[property="og:site_name"]').attr('content') ?? '');
  const description = clean(
    $('meta[name="description"]').attr('content') ??
      $('meta[property="og:description"]').attr('content') ??
      '',
  );

  $(NON_CONTENT).remove();
  $(CHROME).remove();
  $('br').replaceWith('\n');
  $(INLINE_SEPARATED).each((_, element) => {
    $(element).append(' ');
  });
  $(BLOCKS).each((_, element) => {
    $(element).append('\n');
  });

  const main = $('main, article, [role="main"]').first();
  const mainText = main.length > 0 ? normalizeText(main.text()) : '';
  const text =
    mainText.length >= 200 ? mainText : normalizeText($('body').text() || $.root().text());

  return { title, h1, siteName, description, text, links };
}
