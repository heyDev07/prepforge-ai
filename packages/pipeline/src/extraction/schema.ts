/**
 * Schema for the raw extraction reply. It is deliberately tolerant of harmless variation
 * (e.g. "behavioral" vs "behavioural", "required" vs "must") so a correct answer is not
 * rejected on spelling; everything else is enforced afterwards by deterministic code.
 */
import { REQUIREMENT_KINDS, REQUIREMENT_PRIORITIES } from '@prepforge/shared';
import { z } from 'zod';

const KIND_SYNONYMS: Record<string, string> = {
  tech: 'technical',
  skill: 'technical',
  tool: 'technical',
  behavioral: 'behavioural',
  behavior: 'behavioural',
  behaviour: 'behavioural',
  soft: 'behavioural',
  'soft skill': 'behavioural',
  'soft-skill': 'behavioural',
  interpersonal: 'behavioural',
  industry: 'domain',
  business: 'domain',
};

const PRIORITY_SYNONYMS: Record<string, string> = {
  required: 'must',
  'must-have': 'must',
  'must have': 'must',
  mandatory: 'must',
  essential: 'must',
  'nice-to-have': 'nice',
  'nice to have': 'nice',
  preferred: 'nice',
  bonus: 'nice',
  optional: 'nice',
  plus: 'nice',
};

const synonym = (map: Record<string, string>) => (value: unknown) => {
  if (typeof value !== 'string') return value;
  const key = value.trim().toLowerCase();
  return map[key] ?? key;
};

const optionalText = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed && !/^(n\/a|none|null|unknown|not specified|not stated)$/i.test(trimmed)
      ? trimmed
      : null;
  });

export const RawRequirementSchema = z.object({
  text: z.string().trim().min(1).max(400),
  kind: z.preprocess(synonym(KIND_SYNONYMS), z.enum(REQUIREMENT_KINDS)),
  priority: z.preprocess(synonym(PRIORITY_SYNONYMS), z.enum(REQUIREMENT_PRIORITIES)),
  source_quote: z.string().trim().min(1).max(800),
});

export const ExtractionOutputSchema = z.object({
  company_name: optionalText,
  role_title: z.string().trim().min(1).max(200),
  seniority: optionalText,
  location: optionalText,
  responsibilities: z.array(z.string()).max(40).default([]),
  requirements: z.array(RawRequirementSchema).max(60),
});

export type RawRequirement = z.infer<typeof RawRequirementSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
