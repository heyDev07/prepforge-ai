import { describe, expect, it } from 'vitest';
import { backoffDelay, parseRetryAfter, withRetry } from '../src/net/backoff';
import { RateLimiter } from '../src/net/rate-limiter';
import { mapWithConcurrency, Semaphore } from '../src/net/semaphore';

/** A fake clock whose sleep advances time instantly and records each wait. */
function fakeClock(start = 0) {
  let time = start;
  const waits: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
    waits,
  };
}

describe('backoffDelay', () => {
  it('grows exponentially and is capped', () => {
    const top = { baseMs: 100, maxMs: 1_000, random: () => 0.999999 };
    expect([0, 1, 2, 3, 4, 5].map((a) => backoffDelay(a, top))).toEqual([
      100, 200, 400, 800, 1000, 1000,
    ]);
  });

  it('applies full jitter', () => {
    expect(backoffDelay(3, { baseMs: 100, maxMs: 10_000, random: () => 0.5 })).toBe(400);
    expect(backoffDelay(3, { baseMs: 100, maxMs: 10_000, random: () => 0 })).toBe(0);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('7')).toBe(7_000);
    expect(parseRetryAfter('1.5')).toBe(1_500);
    const now = Date.parse('2026-09-23T10:00:00Z');
    expect(parseRetryAfter('Wed, 23 Sep 2026 10:00:30 GMT', now)).toBe(30_000);
  });

  it('returns null for missing or invalid values', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('withRetry', () => {
  const backoff = { baseMs: 100, maxMs: 5_000, random: () => 0.5 };

  it('retries retryable errors until success', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('flaky');
        return 'ok';
      },
      { maxRetries: 3, backoff, shouldRetry: () => ({ retry: true }), sleep: clock.sleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(clock.waits).toEqual([50, 100]);
  });

  it('stops after maxRetries and rethrows the last error', async () => {
    const clock = fakeClock();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error(`fail ${calls}`);
        },
        { maxRetries: 2, backoff, shouldRetry: () => ({ retry: true }), sleep: clock.sleep },
      ),
    ).rejects.toThrow('fail 3');
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('bad request');
        },
        { maxRetries: 5, backoff, shouldRetry: () => ({ retry: false }) },
      ),
    ).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  it('honours a server-requested Retry-After, capped by maxWaitMs', async () => {
    const clock = fakeClock();
    let calls = 0;
    await withRetry(
      async () => {
        if (++calls < 3) throw new Error('429');
      },
      {
        maxRetries: 3,
        backoff: { ...backoff, random: () => 0 },
        maxWaitMs: 10_000,
        shouldRetry: () => ({ retry: true, retryAfterMs: calls === 1 ? 2_000 : 60_000 }),
        sleep: clock.sleep,
      },
    );
    expect(clock.waits).toEqual([2_000, 10_000]);
  });
});

describe('Semaphore', () => {
  it('never exceeds its limit and preserves result order', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (ms, index) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active--;
      return index;
    });
    expect(peak).toBe(2);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('releases the slot when a task throws', async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow();
    await expect(semaphore.run(async () => 'next')).resolves.toBe('next');
    expect(semaphore.inFlight).toBe(0);
  });
});

describe('RateLimiter', () => {
  it('allows `limit` calls per window, then waits for the window to slide', async () => {
    const clock = fakeClock(1_000);
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000, ...clock });
    for (let i = 0; i < 4; i++) await limiter.take();
    expect(clock.waits).toEqual([60_000]);
  });

  it('spaces requests when used as a per-host delay', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ limit: 1, windowMs: 500, ...clock });
    await Promise.all([limiter.take(), limiter.take(), limiter.take()]);
    expect(clock.waits).toEqual([500, 500]);
  });
});
