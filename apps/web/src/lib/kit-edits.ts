/**
 * How edits to a kit reach the server. Every write carries the kit's revision, and the server
 * refuses a stale one (409). An edit made while another is still saving (reorder, then add at
 * once) would otherwise carry the revision from before the first edit and be refused.
 *
 * So edits to one kit run one at a time (a shared mutation scope), and each reads the revision
 * when it is sent, after the previous edit's response has replaced the cached kit.
 */
import type { KitDetailDto } from '@prepforge/shared';
import type { QueryClient } from '@tanstack/react-query';
import { keys } from './job-status';

export function kitEditOptions<TVariables, TData>(
  queryClient: QueryClient,
  id: string,
  send: (variables: TVariables, revision: number) => Promise<TData>,
) {
  return {
    scope: { id: `kit-edit:${id}` },
    mutationFn: (variables: TVariables) =>
      send(variables, queryClient.getQueryData<KitDetailDto>(keys.kit(id))?.revision ?? 0),
  };
}
