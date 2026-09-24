/**
 * HTTP API contract shared by the API (request validation) and the web app (typed client).
 * JSON uses snake_case, like the kit schema.
 */
import { z } from 'zod';
import { MAX_DAYS, MIN_DAYS } from '../constants';
import type { StructuredError } from '../errors';
import type { InternalFlashcard, InternalKit } from './internal-kit';
import { PipelineInputSchema } from './input';
import { DifficultySchema, QuestionCategorySchema, RequirementIdSchema } from './kit';
import type { GenerationJob } from './job';
import { ConfidenceSchema, type CardStats } from './practice';
import type { ResearchBundle } from './research';

// ---------------------------------------------------------------------------------------
// auth

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address.' }))
  .pipe(z.string().max(254));

export const RegisterBodySchema = z.object({
  email: EmailSchema,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password must be at most 128 characters.'),
});

export const LoginBodySchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Enter your password.').max(128),
});

export interface UserDto {
  id: string;
  email: string;
  created_at: string;
}

// ---------------------------------------------------------------------------------------
// kits

export const CreateKitBodySchema = PipelineInputSchema.extend({
  /** Create a new kit even when an identical one (same JD and company) exists. */
  allow_duplicate: z.boolean().optional(),
});

export const UpdateKitBodySchema = z
  .object({
    company_brief: z
      .object({
        summary: z.string().trim().min(1).max(5_000).optional(),
        what_they_do: z.string().trim().min(1).max(2_000).optional(),
        pinned: z.boolean().optional(),
      })
      .optional(),
    days_available: z.number().int().min(MIN_DAYS).max(MAX_DAYS).optional(),
    /** Optimistic concurrency: reject the update if the kit changed since this revision. */
    revision: z.number().int().nonnegative().optional(),
  })
  .refine((body) => body.company_brief !== undefined || body.days_available !== undefined, {
    error: 'Nothing to update.',
  });

export const KIT_STATUSES = ['draft', 'generating', 'ready', 'ready_with_gaps', 'failed'] as const;
export type KitStatus = (typeof KIT_STATUSES)[number];

export interface JobSummaryDto {
  id: string;
  type: GenerationJob['type'];
  status: GenerationJob['status'];
  current_stage: GenerationJob['current_stage'];
  progress: number;
}

export interface KitSummaryDto {
  id: string;
  company: string;
  role: string | null;
  company_url: string;
  status: KitStatus;
  days: number;
  questions: number;
  flashcards: number;
  created_at: string;
  updated_at: string;
  latest_job: JobSummaryDto | null;
}

export interface KitDetailDto {
  id: string;
  status: KitStatus;
  input: { jd: string; company_url: string; days: number };
  kit: InternalKit | null;
  research: ResearchBundle | null;
  notes: string[];
  warnings: { code: string; message: string }[];
  revision: number;
  latest_job: GenerationJob | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------------------
// generation

export const RegenerateCompanyBodySchema = z.object({
  /** Replace a brief the user has edited. */
  force: z.boolean().optional(),
});

// ---------------------------------------------------------------------------------------
// questions and flashcards

const requirementIds = z
  .array(RequirementIdSchema)
  .min(1, 'Select at least one requirement.')
  .max(10);

export const CreateQuestionBodySchema = z.object({
  category: QuestionCategorySchema,
  prompt: z.string().trim().min(1, 'Prompt must not be empty.').max(1_000),
  answer_outline: z.string().trim().min(1, 'Answer outline must not be empty.').max(4_000),
  difficulty: DifficultySchema,
  requirement_ids: requirementIds,
});

export const UpdateQuestionBodySchema = CreateQuestionBodySchema.partial()
  .extend({ pinned: z.boolean().optional(), revision: z.number().int().nonnegative().optional() })
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), {
    error: 'Nothing to update.',
  });

export const ReorderQuestionsBodySchema = z.object({
  category: QuestionCategorySchema,
  ordered_ids: z.array(z.string()).min(1).max(200),
  revision: z.number().int().nonnegative().optional(),
});

export const CreateFlashcardBodySchema = z.object({
  front: z.string().trim().min(1, 'Front must not be empty.').max(600),
  back: z.string().trim().min(1, 'Back must not be empty.').max(2_000),
  requirement_ids: requirementIds,
});

export const UpdateFlashcardBodySchema = CreateFlashcardBodySchema.partial()
  .extend({ pinned: z.boolean().optional(), revision: z.number().int().nonnegative().optional() })
  .refine((body) => Object.keys(body).some((key) => key !== 'revision'), {
    error: 'Nothing to update.',
  });

// ---------------------------------------------------------------------------------------
// practice

export const PracticeBodySchema = z.object({ confidence: ConfidenceSchema });

export const PracticeNextQuerySchema = z.object({
  mode: z.enum(['all', 'weak']).default('all'),
  exclude: z.string().optional(),
});

export interface PracticeNextDto {
  flashcard: InternalFlashcard | null;
  stats: CardStats | null;
  /** Cards available in this mode. */
  remaining: number;
  mode: 'all' | 'weak';
}

// ---------------------------------------------------------------------------------------
// errors

export interface ErrorResponse {
  error: StructuredError & { details?: Record<string, unknown> };
}
