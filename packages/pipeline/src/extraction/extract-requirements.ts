/**
 * extractRequirements(jd): one dedicated LLM call, then deterministic verification.
 *
 * The model proposes; code decides what is kept:
 *   - every requirement must quote the JD; unsupported quotes are dropped (no invention)
 *   - wording that drifts from the JD is replaced by the verified quote
 *   - "preferred / bonus / a plus / nice to have" markers force priority "nice"
 *   - seniority, location and company are kept only when the JD actually states them
 *   - duplicates are removed, order follows the JD, IDs r1..rn are assigned here
 */
import {
  AppError,
  NOT_SPECIFIED,
  type Requirement,
  type RequirementPriority,
} from '@prepforge/shared';
import {
  EXTRACT_REQUIREMENTS_SYSTEM,
  buildExtractRequirementsUser,
} from '../llm/prompts/extract-requirements';
import type { LlmProvider } from '../llm/provider';
import { callStructured } from '../llm/structured-call';
import { collapseWhitespace, truncate } from '../text/sanitize';
import {
  buildMatchIndex,
  isSupportedQuote,
  normalizeForMatch,
  tokenCoverage,
  type MatchIndex,
} from '../text/match';
import { ExtractionOutputSchema, type ExtractionOutput, type RawRequirement } from './schema';

export const MAX_REQUIREMENTS = 25;
export const MAX_RESPONSIBILITIES = 12;
/** Fewer requirements than this is reported as a thin JD. */
export const THIN_JD_THRESHOLD = 3;

const NICE_MARKERS =
  /\b(nice[\s-]to[\s-]have|bonus|preferred|preferably|a plus|is a plus|plus if|desirable|good to have|nice if|ideally|optional|not required|extra credit)\b/i;

export interface DroppedRequirement {
  text: string;
  reason: 'unsupported_quote' | 'duplicate' | 'limit';
}

export interface ExtractionResult {
  roleTitle: string;
  seniority: string;
  location: string;
  /** Company name only when the JD states it. */
  companyName: string | null;
  responsibilities: string[];
  requirements: Requirement[];
  dropped: DroppedRequirement[];
  limitations: string[];
}

interface Located {
  raw: RawRequirement;
  position: number;
  line: string;
  heading: string;
}

const HEADING_WORDS =
  /\b(requirements?|qualifications?|what (you|we)|you (have|bring|are|will|'ll)|skills|experience|about you|nice|bonus|preferred|plus|must|responsibilities|looking for|ideal|in this role|the role)\b/i;

/** A section heading ends with ":" or is a short line with a typical section word. */
function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || /^[-*•\d]/.test(trimmed)) return false;
  return trimmed.endsWith(':') || (trimmed.split(/\s+/).length <= 6 && HEADING_WORDS.test(trimmed));
}

/** Finds where a quote sits in the JD: its line, the nearest heading above it and its offset. */
function locate(
  jdLines: string[],
  quote: string,
): { index: number; line: string; heading: string } {
  const target = normalizeForMatch(quote);
  let best = { index: -1, score: 0 };
  jdLines.forEach((line, index) => {
    const normalizedLine = normalizeForMatch(line);
    if (!normalizedLine) return;
    const score = normalizedLine.includes(target) ? 2 : tokenCoverage(quote, buildMatchIndex(line));
    if (score > best.score) best = { index, score };
  });
  if (best.index === -1) return { index: Number.MAX_SAFE_INTEGER, line: '', heading: '' };
  let heading = '';
  for (let i = best.index - 1; i >= 0; i--) {
    if (isHeading(jdLines[i]!)) {
      heading = jdLines[i]!;
      break;
    }
  }
  return { index: best.index, line: jdLines[best.index]!, heading };
}

function keepIfStated(value: string | null, index: MatchIndex, minCoverage: number): string | null {
  if (!value) return null;
  return tokenCoverage(value, index) >= minCoverage ? collapseWhitespace(value) : null;
}

/** Pure post-processing of a raw model reply. Exported for testing. */
export function postProcessExtraction(jd: string, raw: ExtractionOutput): ExtractionResult {
  const index = buildMatchIndex(jd);
  const jdLines = jd.split(/\r?\n/);
  const dropped: DroppedRequirement[] = [];
  const limitations: string[] = [];

  // 1. keep only requirements whose quote is really in the JD, remembering where it is
  const located: Located[] = [];
  for (const requirement of raw.requirements) {
    if (!isSupportedQuote(requirement.source_quote, index)) {
      dropped.push({ text: requirement.text, reason: 'unsupported_quote' });
      continue;
    }
    const where = locate(jdLines, requirement.source_quote);
    located.push({
      raw: requirement,
      position: where.index,
      line: where.line,
      heading: where.heading,
    });
  }

  // 2. JD order (stable), de-duplicate, cap
  located.sort((a, b) => a.position - b.position);
  const seen = new Set<string>();
  const requirements: Requirement[] = [];
  for (const item of located) {
    const faithful = tokenCoverage(item.raw.text, index) >= 0.6;
    const text = truncate(
      collapseWhitespace(faithful ? item.raw.text : item.raw.source_quote),
      200,
    ).replace(/^[-*•\s]+/, '');
    const key = normalizeForMatch(text);
    if (seen.has(key)) {
      dropped.push({ text, reason: 'duplicate' });
      continue;
    }
    if (requirements.length >= MAX_REQUIREMENTS) {
      dropped.push({ text, reason: 'limit' });
      continue;
    }
    seen.add(key);
    const marked = NICE_MARKERS.test(item.line) || NICE_MARKERS.test(item.heading);
    const priority: RequirementPriority = marked ? 'nice' : item.raw.priority;
    requirements.push({
      id: `r${requirements.length + 1}`,
      text,
      kind: item.raw.kind,
      priority,
    });
  }

  if (requirements.length === 0) {
    throw new AppError(
      'INSUFFICIENT_JD',
      'No requirements could be verified in the job description. Add the skills or experience the role needs.',
      { stage: 'extracting_requirements', status: 422 },
    );
  }

  // 3. responsibilities: faithful, de-duplicated, capped
  const responsibilities: string[] = [];
  const seenResponsibilities = new Set<string>();
  for (const entry of raw.responsibilities) {
    const text = truncate(collapseWhitespace(entry).replace(/^[-*•\s]+/, ''), 300);
    const key = normalizeForMatch(text);
    if (!key || seenResponsibilities.has(key) || tokenCoverage(text, index) < 0.5) continue;
    seenResponsibilities.add(key);
    responsibilities.push(text);
    if (responsibilities.length >= MAX_RESPONSIBILITIES) break;
  }

  // 4. scalar fields: kept only when the JD states them
  const seniority = keepIfStated(raw.seniority, index, 1);
  const location = keepIfStated(raw.location, index, 0.6);
  const companyName =
    raw.company_name && ` ${index.normalized} `.includes(` ${normalizeForMatch(raw.company_name)} `)
      ? collapseWhitespace(raw.company_name)
      : null;

  const unsupported = dropped.filter((d) => d.reason === 'unsupported_quote').length;
  if (requirements.length < THIN_JD_THRESHOLD) {
    limitations.push(
      `The job description is thin: only ${requirements.length} requirement(s) could be extracted, and none were invented.`,
    );
  }
  if (unsupported > 0) {
    limitations.push(
      `${unsupported} proposed requirement(s) were discarded because they could not be found in the job description.`,
    );
  }

  return {
    roleTitle: truncate(collapseWhitespace(raw.role_title), 120),
    seniority: seniority ?? NOT_SPECIFIED,
    location: location ?? NOT_SPECIFIED,
    companyName,
    responsibilities,
    requirements,
    dropped,
    limitations,
  };
}

export async function extractRequirements(
  jd: string,
  llm: LlmProvider,
  options: { signal?: AbortSignal } = {},
): Promise<ExtractionResult> {
  const raw = await callStructured(llm, {
    task: 'extract_requirements',
    system: EXTRACT_REQUIREMENTS_SYSTEM,
    user: buildExtractRequirementsUser(jd),
    schema: ExtractionOutputSchema,
    temperature: 0,
    maxOutputTokens: 4_000,
    signal: options.signal,
  });
  return postProcessExtraction(jd, raw);
}
