import { z } from 'zod';
import { StructuredErrorSchema } from '../errors';
import { GENERATION_STAGES } from '../stages';
import { QuestionCategorySchema } from './kit';

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = ['generate', 'regenerate_company', 'regenerate_questions'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const STAGE_STATUSES = ['running', 'completed', 'failed', 'skipped'] as const;

export const GenerationStageSchema = z.enum(GENERATION_STAGES);

export const StageLogEntrySchema = z.object({
  stage: GenerationStageSchema,
  status: z.enum(STAGE_STATUSES),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  /** Short human-readable progress note, e.g. "5 pages fetched, 2 failed". */
  detail: z.string().nullable(),
});
export type StageLogEntry = z.infer<typeof StageLogEntrySchema>;

export const GenerationJobSchema = z.object({
  id: z.string(),
  kit_id: z.string(),
  type: z.enum(JOB_TYPES),
  category: QuestionCategorySchema.nullable(),
  status: z.enum(JOB_STATUSES),
  current_stage: GenerationStageSchema.nullable(),
  progress: z.number().min(0).max(100),
  stage_log: z.array(StageLogEntrySchema),
  error: StructuredErrorSchema.nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
