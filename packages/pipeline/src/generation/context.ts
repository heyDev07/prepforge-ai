import type { Requirement, ResearchBundle } from '@prepforge/shared';

/** Everything the generation stages may use. Built by the pipeline; never contains full pages. */
export interface GenerationContext {
  companyName: string;
  companyUrl: string;
  role: { title: string; seniority: string; responsibilities: string[] };
  requirements: Requirement[];
  brief: { summary: string; what_they_do: string } | null;
  research: ResearchBundle;
}
