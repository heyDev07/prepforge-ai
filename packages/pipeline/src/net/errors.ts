import type { FetchStatus } from '@prepforge/shared';

/** A failed fetch, classified so callers can record it (research pages) or map it to an AppError. */
export class FetchFailure extends Error {
  readonly status: Exclude<FetchStatus, 'ok'>;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    status: Exclude<FetchStatus, 'ok'>,
    message: string,
    options: { httpStatus?: number | null; retryable?: boolean; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = 'FetchFailure';
    this.status = status;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export function isFetchFailure(error: unknown): error is FetchFailure {
  return error instanceof FetchFailure;
}
