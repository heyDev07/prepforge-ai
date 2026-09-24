import { DEFAULT_CACHE_TTL_MS, type CacheStore } from '@prepforge/pipeline';
import { CacheEntry } from '../models';

/** CacheStore backed by MongoDB with a TTL index; used for crawl and extraction results. */
export class MongoCacheStore implements CacheStore {
  async get<T>(key: string): Promise<T | undefined> {
    const entry = await CacheEntry.findOne({ key, expiresAt: { $gt: new Date() } }).lean();
    return entry ? (entry.value as T) : undefined;
  }

  async set<T>(key: string, value: T, ttlMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    await CacheEntry.updateOne(
      { key },
      { $set: { value, expiresAt: new Date(Date.now() + ttlMs) } },
      { upsert: true },
    );
  }
}
