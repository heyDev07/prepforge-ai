import type { KitDetailDto } from '@prepforge/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkGenerationStatus, keys, type GenerationStatus } from '../src/lib/job-status';

const id = 'kit-1';
const running = { id: 'job-1', status: 'running' };
const completed = { id: 'job-1', status: 'completed' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const detail = (fields: object) => fields as unknown as KitDetailDto;

describe('checkGenerationStatus', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

  /** The kit page when a job has just finished: the kit and the last status cached, both watched. */
  function watch(queryClient: QueryClient, kitDelayMs: number) {
    let kitFetches = 0;
    let statusFetches = 0;
    queryClient.setQueryData(keys.kit(id), detail({ latest_job: running, kit: null }));
    queryClient.setQueryData(keys.status(id), { kit_status: 'generating', job: running });
    const kit = new QueryObserver(queryClient, {
      queryKey: keys.kit(id),
      queryFn: async () => {
        kitFetches += 1;
        await sleep(kitDelayMs);
        return detail({ latest_job: completed, kit: { questions: [] } });
      },
      staleTime: 10_000,
    });
    const status = new QueryObserver(queryClient, {
      queryKey: keys.status(id),
      queryFn: () =>
        checkGenerationStatus(queryClient, id, async () => {
          // a status check that keeps re-triggering itself is the bug: fail instead of looping
          if (++statusFetches > 20) throw new Error('the status check is looping');
          return { kit_status: 'ready', job: completed as GenerationStatus['job'] };
        }),
    });
    cleanups.push(
      kit.subscribe(() => {}),
      status.subscribe(() => {}),
    );
    return { kitFetches: () => kitFetches, statusFetches: () => statusFetches };
  }

  it('reloads the kit once when the job finishes, even when the kit is slower than the status', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { kitFetches, statusFetches } = watch(queryClient, 150);

    await vi.waitFor(
      () => expect(queryClient.getQueryData<KitDetailDto>(keys.kit(id))?.kit).not.toBeNull(),
      { timeout: 5_000 },
    );
    await sleep(300);
    expect(kitFetches()).toBe(1);
    expect(statusFetches()).toBe(1);
    expect(queryClient.getQueryData<KitDetailDto>(keys.kit(id))?.latest_job?.status).toBe(
      'completed',
    );
  });

  it('does not reload the kit when the cached copy already has the finished job', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(keys.kit(id), detail({ latest_job: completed, kit: {} }));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await checkGenerationStatus(queryClient, id, async () => ({
      kit_status: 'ready',
      job: completed as GenerationStatus['job'],
    }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
