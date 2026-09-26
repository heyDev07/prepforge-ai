import type { KitDetailDto } from '@prepforge/shared';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { keys } from '../src/lib/job-status';
import { kitEditOptions } from '../src/lib/kit-edits';

const id = 'kit-1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A server that, like the API, refuses a write carrying a stale revision. */
function fakeServer(start: number) {
  let revision = start;
  const applied: string[] = [];
  return {
    applied,
    async write(edit: string, sent: number): Promise<{ kit: KitDetailDto }> {
      await sleep(30);
      if (sent !== revision) throw new Error(`409 stale revision ${sent}, current ${revision}`);
      revision += 1;
      applied.push(edit);
      return { kit: { revision } as KitDetailDto };
    },
  };
}

function editor(queryClient: QueryClient, server: ReturnType<typeof fakeServer>) {
  return new MutationObserver(queryClient, {
    ...kitEditOptions(queryClient, id, (edit: string, revision) => server.write(edit, revision)),
    // what useKitMutation does with a response: it replaces the cached kit
    onSuccess: (data) => queryClient.setQueryData(keys.kit(id), data.kit),
  });
}

describe('kitEditOptions', () => {
  it('saves an edit made while another is still saving, instead of refusing it as stale', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(keys.kit(id), { revision: 5 } as KitDetailDto);
    const server = fakeServer(5);

    // reorder, then add a question at once, from two different components
    const results = await Promise.allSettled([
      editor(queryClient, server).mutate('reorder'),
      editor(queryClient, server).mutate('add question'),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(server.applied).toEqual(['reorder', 'add question']);
    expect(queryClient.getQueryData<KitDetailDto>(keys.kit(id))?.revision).toBe(7);
  });
});
