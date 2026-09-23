/** Retry primitives shared by the crawler, search providers and LLM layer. */

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Injectable for deterministic tests. Returns a value in [0, 1). */
  random?: () => number;
}

/** Exponential backoff with "full jitter": a random delay in [0, min(max, base·2^attempt)]. */
export function backoffDelay(attempt: number, options: BackoffOptions): number {
  const random = options.random ?? Math.random;
  const ceiling = Math.min(options.maxMs, options.baseMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

/**
 * Parses a Retry-After header (delta-seconds or HTTP-date) into milliseconds.
 * Returns null when absent or unparseable.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

export interface RetryDecision {
  retry: boolean;
  /** Server-requested wait (e.g. Retry-After); takes precedence over computed backoff. */
  retryAfterMs?: number | null;
}

export interface RetryOptions {
  maxRetries: number;
  backoff: BackoffOptions;
  /** Upper bound for any single wait, including server-requested ones. */
  maxWaitMs?: number;
  shouldRetry: (error: unknown) => RetryDecision;
  sleep?: Sleep;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/** Runs fn, retrying retryable failures with backoff + jitter and honouring Retry-After. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const wait = options.sleep ?? sleep;
  const maxWaitMs = options.maxWaitMs ?? 60_000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      const decision = options.shouldRetry(error);
      if (!decision.retry || attempt >= options.maxRetries || options.signal?.aborted) throw error;
      const computed = backoffDelay(attempt, options.backoff);
      const requested = decision.retryAfterMs ?? null;
      const delayMs = Math.min(maxWaitMs, requested !== null ? requested + computed / 4 : computed);
      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await wait(Math.round(delayMs), options.signal);
    }
  }
}
