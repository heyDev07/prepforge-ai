/** Research artefacts kept alongside a kit so the UI can show what was (and was not) found. */
import { z } from 'zod';
import { SOURCE_TYPES } from '../enums';

export const FETCH_STATUSES = [
  'ok',
  'http_error',
  'timeout',
  'robots_disallowed',
  'too_large',
  'bad_content_type',
  'blocked_url',
  'redirect_error',
  'network_error',
] as const;
export type FetchStatus = (typeof FETCH_STATUSES)[number];

export const SourceTypeSchema = z.enum(SOURCE_TYPES);

export const ResearchPageSchema = z.object({
  url: z.string(),
  title: z.string(),
  /** Cleaned visible text (empty when the fetch failed). */
  text: z.string(),
  source_type: SourceTypeSchema,
  fetch_status: z.enum(FETCH_STATUSES),
  http_status: z.number().int().nullable(),
  error: z.string().nullable(),
  depth: z.number().int().nonnegative(),
  score: z.number(),
  retrieved_at: z.string(),
});
export type ResearchPage = z.infer<typeof ResearchPageSchema>;

export const PublicResearchResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  snippet: z.string(),
  source_type: z.literal('public_discussion'),
});
export type PublicResearchResult = z.infer<typeof PublicResearchResultSchema>;

export const PUBLIC_RESEARCH_STATUSES = ['found', 'not_found', 'unavailable'] as const;

export const PublicResearchSchema = z.object({
  /** found = relevant results; not_found = searched, nothing relevant; unavailable = provider failed or disabled */
  status: z.enum(PUBLIC_RESEARCH_STATUSES),
  provider: z.string(),
  queries: z.array(z.string()),
  results: z.array(PublicResearchResultSchema),
  error: z.string().nullable(),
});
export type PublicResearch = z.infer<typeof PublicResearchSchema>;

export const ResearchBundleSchema = z.object({
  company_url: z.string(),
  company_name: z.string(),
  pages: z.array(ResearchPageSchema),
  public_research: PublicResearchSchema,
  /** Honest, human-readable gaps, e.g. "No careers page was found." */
  limitations: z.array(z.string()),
  started_at: z.string(),
  finished_at: z.string(),
});
export type ResearchBundle = z.infer<typeof ResearchBundleSchema>;
