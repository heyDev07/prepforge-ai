import { z } from 'zod';
import { GENERATION_STAGES, type GenerationStage } from './stages';

export const ERROR_CODES = [
  // pipeline — a kit cannot be produced
  'INVALID_INPUT',
  'URL_NOT_ALLOWED',
  'COMPANY_UNREACHABLE',
  'INSUFFICIENT_JD',
  'LLM_NOT_CONFIGURED',
  'LLM_INVALID_OUTPUT',
  'LLM_RATE_LIMITED',
  'LLM_UNAVAILABLE',
  'KIT_VALIDATION_FAILED',
  'PIPELINE_TIMEOUT',
  // API
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'NOT_FOUND',
  'DUPLICATE_KIT',
  'JOB_IN_PROGRESS',
  'CONFLICT',
  'CONFIRMATION_REQUIRED',
  'RATE_LIMITED',
  // fallback
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const StructuredErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  stage: z.enum(GENERATION_STAGES).nullable().optional(),
  retryable: z.boolean(),
});
export type StructuredError = z.infer<typeof StructuredErrorSchema>;

export interface AppErrorOptions {
  stage?: GenerationStage | null;
  retryable?: boolean;
  /** HTTP status the API should use when this error reaches a response. */
  status?: number;
  /** Extra machine-readable data, e.g. { existingKitId }. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

/** The single error type thrown by the pipeline and the API. Messages must be safe to show users. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly stage: GenerationStage | null;
  readonly retryable: boolean;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.stage = options.stage ?? null;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 500;
    this.details = options.details;
  }

  /** Returns a copy of this error attributed to a pipeline stage (keeps an existing stage). */
  atStage(stage: GenerationStage): AppError {
    if (this.stage) return this;
    return new AppError(this.code, this.message, {
      stage,
      retryable: this.retryable,
      status: this.status,
      details: this.details,
      cause: this.cause,
    });
  }

  toJSON(): StructuredError {
    return { code: this.code, message: this.message, stage: this.stage, retryable: this.retryable };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Converts any thrown value into a structured error without leaking internals. */
export function toStructuredError(error: unknown, stage?: GenerationStage): StructuredError {
  if (isAppError(error)) {
    const structured = error.toJSON();
    return { ...structured, stage: structured.stage ?? stage ?? null };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    stage: stage ?? null,
    retryable: true,
  };
}
