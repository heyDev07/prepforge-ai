/**
 * The kit as stored and edited. It is Appendix A plus editing metadata:
 *   - state:  generated | edited | pinned   (decides what regeneration may replace)
 *   - origin: generated | gap_fill | user
 *   - counters for never-reused question / flashcard IDs
 * The pipeline's project() strips this metadata to produce the exact external kit.
 */
import { z } from 'zod';
import { ITEM_ORIGINS, ITEM_STATES } from '../enums';
import { CompanyBriefSchema, FlashcardSchema, KitSchema, QuestionSchema } from './kit';

export const ItemStateSchema = z.enum(ITEM_STATES);
export const ItemOriginSchema = z.enum(ITEM_ORIGINS);

export const InternalQuestionSchema = QuestionSchema.extend({
  state: ItemStateSchema,
  origin: ItemOriginSchema,
});

export const InternalFlashcardSchema = FlashcardSchema.extend({
  state: ItemStateSchema,
  origin: ItemOriginSchema,
});

export const InternalCompanyBriefSchema = CompanyBriefSchema.extend({
  state: ItemStateSchema,
});

export const KitCountersSchema = z.strictObject({
  question: z.number().int().nonnegative(),
  flashcard: z.number().int().nonnegative(),
});

export const InternalKitSchema = KitSchema.extend({
  company_brief: InternalCompanyBriefSchema,
  questions: z.array(InternalQuestionSchema),
  flashcards: z.array(InternalFlashcardSchema),
  counters: KitCountersSchema,
});

export type InternalQuestion = z.infer<typeof InternalQuestionSchema>;
export type InternalFlashcard = z.infer<typeof InternalFlashcardSchema>;
export type InternalCompanyBrief = z.infer<typeof InternalCompanyBriefSchema>;
export type KitCounters = z.infer<typeof KitCountersSchema>;
export type InternalKit = z.infer<typeof InternalKitSchema>;
