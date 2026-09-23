/** Accepted range for the number of preparation days. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 60;

/** Accepted size of a pasted job description. */
export const MIN_JD_CHARS = 20;
export const MAX_JD_CHARS = 30_000;

/** Stable ID formats. Requirement IDs follow JD order; question/flashcard IDs come from a per-kit counter. */
export const REQUIREMENT_ID_PATTERN = /^r[1-9]\d*$/;
export const QUESTION_ID_PATTERN = /^q[1-9]\d*$/;
export const FLASHCARD_ID_PATTERN = /^f[1-9]\d*$/;

/** Value used instead of guessing when the JD does not state a field. */
export const NOT_SPECIFIED = 'Not specified';

/** Version of the batch evaluator output envelope. */
export const BATCH_OUTPUT_VERSION = '1.0';
