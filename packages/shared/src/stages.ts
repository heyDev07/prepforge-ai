/**
 * Generation stages, in the order the pipeline runs them.
 * "validating" appears twice by design: input validation first, kit validation near the end.
 */
export const PIPELINE_STAGE_SEQUENCE = [
  'validating',
  'extracting_requirements',
  'researching_company',
  'researching_interviews',
  'generating_company_brief',
  'generating_questions',
  'checking_coverage',
  'generating_missing_questions',
  'generating_flashcards',
  'building_schedule',
  'validating',
  'persisting',
  'completed',
] as const;

export const GENERATION_STAGES = [...new Set(PIPELINE_STAGE_SEQUENCE)] as [
  (typeof PIPELINE_STAGE_SEQUENCE)[number],
  ...(typeof PIPELINE_STAGE_SEQUENCE)[number][],
];
export type GenerationStage = (typeof PIPELINE_STAGE_SEQUENCE)[number];
