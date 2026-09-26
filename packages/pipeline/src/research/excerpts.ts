/**
 * Deterministic selection of research material for prompts. Only a few short excerpts are sent,
 * never whole pages. Company pages are labelled S1..Sn, public discussion P1..Pm, so the model
 * can cite them and code can map the citations back to URLs.
 */
import type { ResearchBundle, ResearchPage, SourceType } from '@prepforge/shared';
import type { UntrustedSource } from '../llm/prompts/untrusted';

const BRIEF_PRIORITY: SourceType[] = [
  'homepage',
  'about',
  'careers',
  'interview',
  'engineering',
  'culture',
  'other',
];
const FIT_PRIORITY: SourceType[] = [
  'about',
  'culture',
  'careers',
  'interview',
  'engineering',
  'homepage',
  'other',
];

export interface SelectedSources {
  sources: UntrustedSource[];
  /** Citation label → URL, for mapping model citations back to sources. */
  urlsByLabel: Map<string, string>;
}

function rank(pages: ResearchPage[], priority: SourceType[]): ResearchPage[] {
  return pages
    .filter((page) => page.fetch_status === 'ok' && page.text.trim().length > 0)
    .map((page, index) => ({ page, index }))
    .sort(
      (a, b) =>
        priority.indexOf(a.page.source_type) - priority.indexOf(b.page.source_type) ||
        a.page.depth - b.page.depth ||
        a.index - b.index,
    )
    .map(({ page }) => page);
}

export function selectResearchSources(
  bundle: ResearchBundle,
  options: { focus: 'brief' | 'fit'; maxPages: number; maxPublic: number },
): SelectedSources {
  const urlsByLabel = new Map<string, string>();
  const sources: UntrustedSource[] = [];

  const pages = rank(bundle.pages, options.focus === 'brief' ? BRIEF_PRIORITY : FIT_PRIORITY).slice(
    0,
    options.maxPages,
  );
  pages.forEach((page, i) => {
    const label = `S${i + 1}`;
    urlsByLabel.set(label, page.url);
    sources.push({
      label,
      type: page.source_type,
      url: page.url,
      title: page.title,
      content: page.text,
    });
  });

  bundle.public_research.results.slice(0, options.maxPublic).forEach((result, i) => {
    const label = `P${i + 1}`;
    urlsByLabel.set(label, result.url);
    sources.push({
      label,
      type: 'public_discussion',
      url: result.url,
      title: result.title,
      content: `${result.title}\n${result.snippet}`,
    });
  });

  return { sources, urlsByLabel };
}

/** Human-readable research gaps, decided by code (not the model). */
/**
 * True for limitations that are gaps a candidate should know about: no careers or about page,
 * a careers/about page that failed, most of the site failing, robots.txt blocks. Crawl
 * mechanics (the page limit, the byte cap) and a few unimportant failed pages are not gaps;
 * they stay in the research log only.
 */
export function isResearchGap(limitation: string): boolean {
  if (/^\d+ other page\(s\) could not be fetched/.test(limitation)) return false;
  return /careers|about|most pages|disallow|robots/i.test(limitation);
}

export function researchNotes(bundle: ResearchBundle): string[] {
  const notes: string[] = [];
  const okPages = bundle.pages.filter((p) => p.fetch_status === 'ok');
  if (okPages.length === 0) notes.push('No pages from the company website could be read.');
  notes.push(...bundle.limitations.filter(isResearchGap));
  if (bundle.public_research.status === 'not_found') {
    notes.push("No public discussion of the company's interview process was found.");
  } else if (bundle.public_research.status === 'unavailable') {
    notes.push('Public discussion of the interview process could not be searched.');
  }
  return [...new Set(notes)];
}
