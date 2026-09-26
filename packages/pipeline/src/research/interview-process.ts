/**
 * What the research says about HOW the company interviews, decided by code:
 *
 *   formats  – which interview formats are described (take-home, live coding, system design,
 *              behavioural), matched with fixed patterns in interview/careers pages and public
 *              discussion only, never in marketing pages
 *   sources  – short excerpts from those texts, for the question prompts
 *
 * Question generation uses both, so a company that publishes "take-home, then system design"
 * gets a different kit from one that says nothing (see generation/questions.ts).
 */
import type { ResearchBundle, ResearchPage } from '@prepforge/shared';
import type { UntrustedSource } from '../llm/prompts/untrusted';

export const INTERVIEW_FORMATS = [
  'take-home',
  'live-coding',
  'system-design',
  'behavioural',
] as const;
export type InterviewFormat = (typeof INTERVIEW_FORMATS)[number];

export const INTERVIEW_FORMAT_LABELS: Record<InterviewFormat, string> = {
  'take-home': 'take-home assignment',
  'live-coding': 'live coding or pairing',
  'system-design': 'system design round',
  behavioural: 'behavioural or values interview',
};

const FORMAT_PATTERNS: Record<InterviewFormat, RegExp> = {
  'take-home':
    /\btake[\s-]?home\b|\bhome (assignment|assessment|exercise|task)\b|\bcoding (assignment|challenge|exercise|test)\b/i,
  'live-coding':
    /\b(live|pair)[\s-]?(coding|programming)\b|\b(live )?pairing\b|\bcoding (interview|round)\b|\bwhiteboard/i,
  'system-design': /\bsystems?[\s-]design\b|\barchitecture (interview|round|discussion)\b/i,
  behavioural:
    /\bbehaviou?ral (interview|round|questions)\b|\b(values|culture[\s-]fit) (interview|round)\b/i,
};

/** Text about the hiring process, not job listings: an interview page, or a careers page that mentions interviews. */
const PROCESS_WORDS = /\binterview|hiring process|recruit(ing|ment) process|how we hire\b/i;
const EXCERPT_CHARS = 1_500;

export interface InterviewProcess {
  formats: InterviewFormat[];
  sources: UntrustedSource[];
}

/** The part of a long page around its first mention of the process. */
function excerpt(text: string): string {
  const at = text.search(PROCESS_WORDS);
  const start = Math.max(0, at - 300);
  return text.slice(start, start + EXCERPT_CHARS);
}

export function findInterviewProcess(
  bundle: ResearchBundle,
  options: { maxPages: number; maxPublic: number } = { maxPages: 2, maxPublic: 3 },
): InterviewProcess {
  const readable = (page: ResearchPage) => page.fetch_status === 'ok' && page.text.trim() !== '';
  const pages = [
    ...bundle.pages.filter((p) => readable(p) && p.source_type === 'interview'),
    ...bundle.pages.filter(
      (p) => readable(p) && p.source_type === 'careers' && PROCESS_WORDS.test(p.text),
    ),
  ].slice(0, options.maxPages);
  const discussion =
    bundle.public_research.status === 'found'
      ? bundle.public_research.results.slice(0, options.maxPublic)
      : [];

  const sources: UntrustedSource[] = [
    ...pages.map((page, i) => ({
      label: `INTERVIEW_PROCESS_${i + 1}`,
      type: page.source_type,
      url: page.url,
      title: page.title,
      content: excerpt(page.text),
    })),
    ...discussion.map((result, i) => ({
      label: `INTERVIEW_DISCUSSION_${i + 1}`,
      type: 'public_discussion',
      url: result.url,
      title: result.title,
      content: `${result.title}\n${result.snippet}`.slice(0, EXCERPT_CHARS),
    })),
  ];

  const evidence = sources.map((source) => source.content).join('\n');
  const formats = INTERVIEW_FORMATS.filter((format) => FORMAT_PATTERNS[format].test(evidence));
  return { formats, sources };
}
