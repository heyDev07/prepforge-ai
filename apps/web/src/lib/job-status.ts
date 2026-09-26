/**
 * Query keys, and what happens when a polled generation job finishes. Kept free of React so
 * the refresh logic can be tested against a real QueryClient.
 */
import type { GenerationJob, KitDetailDto } from '@prepforge/shared';
import type { QueryClient } from '@tanstack/react-query';

export const keys = {
  me: ['me'] as const,
  kits: ['kits'] as const,
  kit: (id: string) => ['kit', id] as const,
  status: (id: string) => ['kit', id, 'status'] as const,
  weakSpots: (id: string) => ['kit', id, 'weak-spots'] as const,
};

export const isActive = (job: { status: string } | null | undefined) =>
  job?.status === 'queued' || job?.status === 'running';

export interface GenerationStatus {
  kit_status: KitDetailDto['status'];
  job: GenerationJob | null;
}

/**
 * Fetches the job status and, once the job has finished, reloads the kit if the cached copy
 * predates the result.
 *
 * The kit is reloaded on its own key (`exact`), because the status key starts with it, and
 * without cancelling a reload already on the way (`cancelRefetch: false`). Otherwise the
 * small status answer re-triggers itself and cancels the larger kit download each time, and
 * on a slow connection the kit never arrives.
 */
export async function checkGenerationStatus(
  queryClient: QueryClient,
  id: string,
  fetchStatus: (id: string) => Promise<GenerationStatus>,
): Promise<GenerationStatus> {
  const status = await fetchStatus(id);
  const cached = queryClient.getQueryData<KitDetailDto>(keys.kit(id));
  const finished = !isActive(status.job);
  if (
    finished &&
    cached &&
    (cached.latest_job?.id !== status.job?.id || isActive(cached.latest_job))
  ) {
    await queryClient.invalidateQueries(
      { queryKey: keys.kit(id), exact: true },
      { cancelRefetch: false },
    );
    await queryClient.invalidateQueries({ queryKey: keys.weakSpots(id) });
    await queryClient.invalidateQueries({ queryKey: keys.kits });
  }
  return status;
}
