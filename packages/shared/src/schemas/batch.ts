/**
 * Batch evaluator contract.
 * Input cases are parsed leniently (only the array shape is required up front) so that one
 * malformed case is reported as a failed case instead of aborting the whole run.
 */
import { z } from 'zod';
import { BATCH_OUTPUT_VERSION } from '../constants';
import { ERROR_CODES } from '../errors';
import { KitSchema } from './kit';

export const BatchInputSchema = z.array(z.unknown());

export const BatchCaseSchema = z.object({
  id: z.string().trim().min(1),
  jd: z.unknown(),
  company_url: z.unknown(),
  days: z.unknown(),
});

export const BatchErrorSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  message: z.string(),
});

export const BatchKitResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    id: z.string(),
    status: z.literal('ok'),
    kit: KitSchema,
    error: z.null(),
  }),
  z.strictObject({
    id: z.string(),
    status: z.literal('failed'),
    kit: z.null(),
    error: BatchErrorSchema,
  }),
]);

export const BatchOutputSchema = z.strictObject({
  version: z.literal(BATCH_OUTPUT_VERSION),
  generated_at: z.iso.datetime({ offset: true }),
  kits: z.array(BatchKitResultSchema),
});

export type BatchKitResult = z.infer<typeof BatchKitResultSchema>;
export type BatchOutput = z.infer<typeof BatchOutputSchema>;
