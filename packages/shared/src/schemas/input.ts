import { z } from 'zod';
import { MAX_DAYS, MAX_JD_CHARS, MIN_DAYS, MIN_JD_CHARS } from '../constants';

/** What the user (web) or a batch case supplies to start a kit. */
export const PipelineInputSchema = z.object({
  jd: z
    .string()
    .trim()
    .min(MIN_JD_CHARS, `Job description must be at least ${MIN_JD_CHARS} characters.`)
    .max(MAX_JD_CHARS, `Job description must be at most ${MAX_JD_CHARS} characters.`),
  company_url: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https?$/, error: 'Company URL must be a valid http(s) URL.' })),
  days: z
    .number()
    .int('Days must be a whole number.')
    .min(MIN_DAYS, `Days must be between ${MIN_DAYS} and ${MAX_DAYS}.`)
    .max(MAX_DAYS, `Days must be between ${MIN_DAYS} and ${MAX_DAYS}.`),
});
export type PipelineInput = z.infer<typeof PipelineInputSchema>;
