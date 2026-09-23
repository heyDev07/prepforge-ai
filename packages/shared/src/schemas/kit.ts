/**
 * Appendix A — the external kit contract.
 *
 * Every object is strict: unknown keys are rejected so the exported JSON always
 * matches the specification exactly. Referential rules (e.g. a question may only
 * reference existing requirements) live in the pipeline's validateKit(), which
 * builds on these schemas.
 */
import { z } from 'zod';
import {
  FLASHCARD_ID_PATTERN,
  QUESTION_ID_PATTERN,
  REQUIREMENT_ID_PATTERN,
} from '../constants';
import { QUESTION_CATEGORIES, REQUIREMENT_KINDS, REQUIREMENT_PRIORITIES } from '../enums';

const nonEmpty = z.string().trim().min(1);
const httpUrl = z.url({ protocol: /^https?$/ });

export const RequirementIdSchema = z.string().regex(REQUIREMENT_ID_PATTERN, 'must look like r1, r2, …');
export const QuestionIdSchema = z.string().regex(QUESTION_ID_PATTERN, 'must look like q1, q2, …');
export const FlashcardIdSchema = z.string().regex(FLASHCARD_ID_PATTERN, 'must look like f1, f2, …');

export const RequirementKindSchema = z.enum(REQUIREMENT_KINDS);
export const RequirementPrioritySchema = z.enum(REQUIREMENT_PRIORITIES);
export const QuestionCategorySchema = z.enum(QUESTION_CATEGORIES);
export const DifficultySchema = z.number().int().min(1).max(3);

export const SourceSchema = z.strictObject({
  company: nonEmpty,
  company_url: httpUrl,
  role: nonEmpty,
  location: z.string(),
  jd_chars: z.number().int().nonnegative(),
  researched_at: z.iso.datetime({ offset: true }),
  pages_used: z.array(httpUrl),
});

export const CompanyBriefSchema = z.strictObject({
  summary: nonEmpty,
  what_they_do: nonEmpty,
  sources: z.array(httpUrl),
});

export const RequirementSchema = z.strictObject({
  id: RequirementIdSchema,
  text: nonEmpty,
  kind: RequirementKindSchema,
  priority: RequirementPrioritySchema,
});

export const RoleSchema = z.strictObject({
  title: nonEmpty,
  seniority: nonEmpty,
  responsibilities: z.array(nonEmpty),
  requirements: z.array(RequirementSchema),
});

export const QuestionSchema = z.strictObject({
  id: QuestionIdSchema,
  requirement_ids: z.array(RequirementIdSchema).min(1),
  category: QuestionCategorySchema,
  prompt: nonEmpty,
  answer_outline: nonEmpty,
  difficulty: DifficultySchema,
});

export const FlashcardSchema = z.strictObject({
  id: FlashcardIdSchema,
  front: nonEmpty,
  back: nonEmpty,
  requirement_ids: z.array(RequirementIdSchema).min(1),
});

export const ScheduleDaySchema = z.strictObject({
  day: z.number().int().min(1),
  focus: nonEmpty,
  question_ids: z.array(QuestionIdSchema),
  minutes: z.number().int().nonnegative(),
});

export const ScheduleSchema = z.strictObject({
  days_available: z.number().int().min(1),
  days: z.array(ScheduleDaySchema).min(1),
});

export const CoverageSchema = z.strictObject({
  uncovered_requirement_ids: z.array(RequirementIdSchema),
  passes: z.number().int().min(1),
});

export const KitSchema = z.strictObject({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
});

export type Source = z.infer<typeof SourceSchema>;
export type CompanyBrief = z.infer<typeof CompanyBriefSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type Kit = z.infer<typeof KitSchema>;
