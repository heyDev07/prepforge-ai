'use client';

import type { GenerationJob, KitDetailDto } from '@prepforge/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { useToast } from '@/components/toast';
import type { ApiError } from './api';
import { api, type KitResponse } from './api';
import { checkGenerationStatus, isActive, keys } from './job-status';
import { kitEditOptions, kitScope } from './kit-edits';

export { keys };

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, retry: false, staleTime: 60_000 });
}

export function useKits() {
  return useQuery({
    queryKey: keys.kits,
    queryFn: api.listKits,
    // keep dashboard progress fresh while something is generating
    refetchInterval: (query) =>
      query.state.data?.kits.some((kit) => kit.status === 'generating' || isActive(kit.latest_job))
        ? 3_000
        : false,
  });
}

export function useKit(id: string) {
  return useQuery({ queryKey: keys.kit(id), queryFn: () => api.getKit(id).then((r) => r.kit) });
}

/**
 * Polls the latest job while it is queued or running. When it finishes, the kit (and its
 * derived data) is refetched so the builder shows the result.
 */
export function useGenerationStatus(id: string, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: keys.status(id),
    queryFn: () => checkGenerationStatus(queryClient, id, api.generationStatus),
    enabled,
    refetchInterval: (query) => (isActive(query.state.data?.job) ? 1_500 : false),
  });
}

export function useWeakSpots(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.weakSpots(id),
    queryFn: () => api.weakSpots(id).then((r) => r.weak_spots),
    enabled,
  });
}

/**
 * Mutation that returns an updated kit: the response replaces the cached kit (no refetch),
 * and a stale-revision conflict reloads the kit and tells the user. Edits to one kit are sent
 * one at a time, each with the latest revision (see kit-edits.ts).
 */
export function useKitMutation<TVariables, TData extends KitResponse>(
  id: string,
  mutationFn: (variables: TVariables, revision: number) => Promise<TData>,
  options: { success?: string | ((data: TData) => string) } & Omit<
    UseMutationOptions<TData, ApiError, TVariables>,
    'mutationFn'
  > = {},
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { success, onSuccess, onError, ...rest } = options;
  return useMutation<TData, ApiError, TVariables>({
    ...rest,
    ...kitEditOptions(queryClient, id, mutationFn),
    onSuccess: (data, variables, ...other) => {
      queryClient.setQueryData(keys.kit(id), data.kit);
      void queryClient.invalidateQueries({ queryKey: keys.weakSpots(id) });
      void queryClient.invalidateQueries({ queryKey: keys.kits });
      if (success) toast(typeof success === 'function' ? success(data) : success);
      onSuccess?.(data, variables, ...other);
    },
    onError: (error, variables, ...other) => {
      if (error.code === 'CONFLICT' || error.code === 'JOB_IN_PROGRESS') {
        void queryClient.invalidateQueries({ queryKey: keys.kit(id) });
      }
      toast(error.message, 'error');
      onError?.(error, variables, ...other);
    },
  });
}

/** Starts a generation/regeneration job and begins polling its status. */
export function useStartJob<TVariables>(
  id: string,
  mutationFn: (variables: TVariables) => Promise<{ job: GenerationJob }>,
  success?: string,
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation<{ job: GenerationJob }, ApiError, TVariables>({
    // after any edit still waiting to be saved (see kit-edits.ts)
    scope: kitScope(id),
    mutationFn,
    onSuccess: ({ job }) => {
      queryClient.setQueryData(keys.status(id), (previous: { kit_status: string } | undefined) => ({
        kit_status: previous?.kit_status ?? 'generating',
        job,
      }));
      queryClient.setQueryData<KitDetailDto>(keys.kit(id), (kit) =>
        kit ? { ...kit, latest_job: job } : kit,
      );
      void queryClient.invalidateQueries({ queryKey: keys.status(id) });
      if (success) toast(success);
    },
    onError: (error) => {
      if (error.code === 'JOB_IN_PROGRESS') {
        void queryClient.invalidateQueries({ queryKey: keys.status(id) });
      }
      if (error.code !== 'CONFIRMATION_REQUIRED') toast(error.message, 'error');
    },
  });
}

declare module '@tanstack/react-query' {
  interface Register {
    /** Every request goes through api.ts, which only throws ApiError. */
    defaultError: ApiError;
  }
}
