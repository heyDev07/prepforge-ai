/**
 * generateCompanyBrief: one LLM call over a few labelled research excerpts.
 * Code maps cited labels to URLs (unknown labels are dropped) and appends research gaps that
 * code determined, so missing information is always stated honestly.
 */
import type { CompanyBrief, ResearchBundle } from '@prepforge/shared';
import { z } from 'zod';
import { COMPANY_BRIEF_SYSTEM, buildCompanyBriefUser } from '../llm/prompts/generation';
import type { LlmProvider } from '../llm/provider';
import { callStructured } from '../llm/structured-call';
import { researchNotes, selectResearchSources } from '../research/excerpts';
import { collapseWhitespace, truncate } from '../text/sanitize';

/** Source labels the model sometimes writes into prose: "[S2, S3]", "(P1)", "[S1][P2]". */
const INLINE_CITATIONS = /\s*[([]\s*[SP]\d+(?:\s*[,;]\s*[SP]\d+)*\s*[)\]]/g;

/** Removes inline citation labels from text, returning the labels so they still count. */
function stripInlineCitations(text: string): { text: string; labels: string[] } {
  const labels = (text.match(INLINE_CITATIONS) ?? []).flatMap((m) => m.match(/[SP]\d+/g) ?? []);
  return { text: text.replace(INLINE_CITATIONS, ''), labels };
}

const BriefOutputSchema = z.object({
  what_they_do: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  cited_sources: z.array(z.coerce.string()).default([]),
});

export interface BriefInput {
  companyName: string;
  companyUrl: string;
  roleTitle: string;
  jd: string;
  research: ResearchBundle;
}

export interface BriefResult {
  brief: CompanyBrief;
  /** URLs whose content was sent to the model. */
  pagesUsed: string[];
}

export async function generateCompanyBrief(
  input: BriefInput,
  llm: LlmProvider,
  options: { signal?: AbortSignal } = {},
): Promise<BriefResult> {
  const { sources, urlsByLabel } = selectResearchSources(input.research, {
    focus: 'brief',
    maxPages: 6,
    maxPublic: 5,
  });

  const raw = await callStructured(llm, {
    task: 'company_brief',
    system: COMPANY_BRIEF_SYSTEM,
    user: buildCompanyBriefUser(
      {
        label: 'CONTEXT',
        type: 'kit_context',
        content: `Company: ${input.companyName}\nWebsite: ${input.companyUrl}\nRole: ${input.roleTitle}`,
      },
      { label: 'JD', type: 'job_description', content: truncate(input.jd, 1_500) },
      sources,
    ),
    schema: BriefOutputSchema,
    temperature: 0.2,
    maxOutputTokens: 1_200,
    signal: options.signal,
  });

  const whatTheyDo = stripInlineCitations(raw.what_they_do);
  const rawSummary = stripInlineCitations(raw.summary);
  const cited = [
    ...new Set(
      [...raw.cited_sources, ...whatTheyDo.labels, ...rawSummary.labels]
        .map((label) => urlsByLabel.get(label.trim().toUpperCase()))
        .filter((url): url is string => Boolean(url)),
    ),
  ];
  const notes = researchNotes(input.research);
  const summary = truncate(collapseWhitespace(rawSummary.text), 2_500);

  return {
    brief: {
      what_they_do: truncate(collapseWhitespace(whatTheyDo.text), 800),
      summary: notes.length > 0 ? `${summary}\n\nResearch notes: ${notes.join(' ')}` : summary,
      sources: cited,
    },
    pagesUsed: [...urlsByLabel.values()],
  };
}
