/**
 * Wraps any provider with the reliability policy shared by the web app and the evaluator:
 *   - at most `maxConcurrency` requests in flight (semaphore)
 *   - at most `requestsPerMinute` requests in any 60 s window
 *   - retries of rate-limit / timeout / 5xx failures with exponential backoff + jitter,
 *     honouring Retry-After
 * One instance is shared process-wide, so batch cases compete for the same budget instead of
 * firing dozens of requests at once. Final failures become structured AppErrors.
 */
import { withRetry, type Sleep } from '../net/backoff';
import { RateLimiter } from '../net/rate-limiter';
import { Semaphore } from '../net/semaphore';
import { toLlmAppError } from './errors';
import { LlmTransportError, type LlmProvider, type LlmRequest, type LlmResponse } from './provider';

export interface LimitedProviderOptions {
  maxConcurrency: number;
  requestsPerMinute: number;
  maxRetries: number;
  sleep?: Sleep;
  now?: () => number;
  random?: () => number;
  onRetry?: (info: { task: string; attempt: number; delayMs: number; reason: string }) => void;
}

export class LimitedLlmProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private readonly semaphore: Semaphore;
  private readonly limiter: RateLimiter;

  constructor(
    private readonly inner: LlmProvider,
    private readonly options: LimitedProviderOptions,
  ) {
    this.name = inner.name;
    this.model = inner.model;
    this.semaphore = new Semaphore(options.maxConcurrency);
    this.limiter = new RateLimiter({
      limit: options.requestsPerMinute,
      windowMs: 60_000,
      now: options.now,
      sleep: options.sleep,
    });
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    try {
      return await this.semaphore.run(() =>
        withRetry(
          async () => {
            await this.limiter.take();
            return this.inner.generate(request);
          },
          {
            maxRetries: this.options.maxRetries,
            backoff: { baseMs: 2_000, maxMs: 30_000, random: this.options.random },
            maxWaitMs: 60_000,
            shouldRetry: (error) =>
              error instanceof LlmTransportError && error.retryable
                ? { retry: true, retryAfterMs: error.retryAfterMs }
                : { retry: false },
            sleep: this.options.sleep,
            signal: request.signal,
            onRetry: ({ attempt, delayMs, error }) =>
              this.options.onRetry?.({
                task: request.task,
                attempt,
                delayMs,
                reason: error instanceof Error ? error.message : String(error),
              }),
          },
        ),
      );
    } catch (error) {
      if (request.signal?.aborted) throw error;
      throw toLlmAppError(error);
    }
  }
}
