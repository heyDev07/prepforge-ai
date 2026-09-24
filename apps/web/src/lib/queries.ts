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

export const keys = {
  me: ['me'] as const,
  kits: ['kits'] as const,
  kit: (id: string) => ['kit', id] as const,
  status: (id: string) => ['kit', id, 'status'] as const,
  weakSpots: (id: string) => ['kit', id, 'weak-spots'] as const,
};

const isActive = (job: { status: string } | null | undefined) =>
  job?.status === 'queued' || job?.status === 'running';

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
    queryFn: async () => {
      const status = await api.generationStatus(id);
      const cached = queryClient.getQueryData<KitDetailDto>(keys.kit(id));
      const finished = !isActive(status.job);
      if (
        finished &&
        cached &&
        (cached.latest_job?.id !== status.job?.id || isActive(cached.latest_job))
      ) {
        await queryClient.invalidateQueries({ queryKey: keys.kit(id) });
        await queryClient.invalidateQueries({ queryKey: keys.weakSpots(id) });
        await queryClient.invalidateQueries({ queryKey: keys.kits });
      }
      return status;
    },
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
 * and a stale-revision conflict reloads the kit and tells the user.
 */
export function useKitMutation<TVariables, TData extends KitResponse>(
  id: string,
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: { success?: string | ((data: TData) => string) } & Omit<
    UseMutationOptions<TData, ApiError, TVariables>,
    'mutationFn'
  > = {},
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { success, onSuccess, onError, ...rest } = options;
  return useMutation<TData, ApiError, TVariables>({
    mutationFn,
    ...rest,
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
