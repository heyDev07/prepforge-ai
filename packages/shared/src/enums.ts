/** Enumerations used by the Appendix A kit schema. Values must not change. */
export const REQUIREMENT_KINDS = ['technical', 'behavioural', 'domain'] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const REQUIREMENT_PRIORITIES = ['must', 'nice'] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

export const QUESTION_CATEGORIES = [
  'technical',
  'behavioural',
  'system-design',
  'company-fit',
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export const DIFFICULTIES = [1, 2, 3] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Editing state of a generated item (internal metadata, never exported). */
export const ITEM_STATES = ['generated', 'edited', 'pinned'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** Where an item came from (internal metadata, never exported). */
export const ITEM_ORIGINS = ['generated', 'gap_fill', 'user'] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

/** Classification of a crawled page. */
export const SOURCE_TYPES = [
  'homepage',
  'about',
  'careers',
  'engineering',
  'culture',
  'interview',
  'other',
  'public_discussion',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
