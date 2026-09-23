/**
 * Cache for work that depends only on public data or on the submitter's own input
 * (company crawls keyed by URL, extraction keyed by JD). Kits are never cached here.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
}

export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return structuredClone(entry.value) as T;
  }

  async set<T>(key: string, value: T, ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    this.entries.set(key, { value: structuredClone(value), expiresAt: this.now() + ttlMs });
  }
}

/**
 * Returns the cached value or computes and stores it. Concurrent callers for the same key
 * share one computation (useful when duplicate batch cases run at the same time).
 */
export function createCachedLoader(cache: CacheStore | undefined) {
  const inflight = new Map<string, Promise<unknown>>();
  return async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    if (!cache) return compute();
    const hit = await cache.get<T>(key);
    if (hit !== undefined) return hit;
    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const promise = compute()
      .then(async (value) => {
        await cache.set(key, value);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
}
