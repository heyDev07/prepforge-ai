import { sleep as realSleep, type Sleep } from './backoff';

export interface RateLimiterOptions {
  /** Maximum number of acquisitions inside any window. */
  limit: number;
  windowMs: number;
  now?: () => number;
  sleep?: Sleep;
}

/**
 * Sliding-window rate limiter. Callers are served strictly in arrival order.
 *  - LLM:     { limit: requestsPerMinute, windowMs: 60_000 }
 *  - crawler: { limit: 1, windowMs: crawlDelay } spaces requests to one host
 */
export class RateLimiter {
  private readonly stamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly sleep: Sleep;

  constructor(private readonly options: RateLimiterOptions) {
    if (options.limit < 1 || options.windowMs < 0) throw new Error('Invalid rate limiter options');
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
  }

  take(): Promise<void> {
    const turn = this.queue.then(() => this.waitForSlot());
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async waitForSlot(): Promise<void> {
    const { limit, windowMs } = this.options;
    for (;;) {
      const now = this.now();
      while (this.stamps.length > 0 && now - this.stamps[0]! >= windowMs) this.stamps.shift();
      if (this.stamps.length < limit) {
        this.stamps.push(now);
        return;
      }
      await this.sleep(windowMs - (now - this.stamps[0]!));
    }
  }
}
