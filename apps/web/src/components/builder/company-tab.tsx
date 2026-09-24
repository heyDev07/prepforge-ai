'use client';

import { ExternalLink, Pencil, Pin, PinOff, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, Field, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { hostname } from '@/lib/labels';
import { useKitMutation, useStartJob } from '@/lib/queries';
import { useBuilder } from './context';

const FETCH_TONES = {
  ok: 'green',
  robots_disallowed: 'amber',
  http_error: 'red',
  timeout: 'red',
  too_large: 'red',
  bad_content_type: 'neutral',
  blocked_url: 'red',
  redirect_error: 'red',
  network_error: 'red',
} as const;

export function CompanyTab() {
  const { id, kit, detail, busy } = useBuilder();
  const brief = kit.company_brief;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ summary: brief.summary, what_they_do: brief.what_they_do });
  const [confirming, setConfirming] = useState(false);

  const save = useKitMutation(
    id,
    (patch: { summary?: string; what_they_do?: string; pinned?: boolean }) =>
      api.updateKit(id, { company_brief: patch, revision: detail.revision }),
    { onSuccess: () => setEditing(false) },
  );
  const regenerate = useStartJob(
    id,
    (force: boolean) => api.regenerateCompany(id, force),
    'Regenerating the company brief…',
  );

  function startRegeneration() {
    if (brief.state === 'edited') setConfirming(true);
    else regenerate.mutate(false);
  }

  const research = detail.research;
  const pages = research?.pages ?? [];
  const publicResearch = research?.public_research;

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">Company brief</h2>
            {brief.state !== 'generated' ? (
              <Badge tone={brief.state === 'pinned' ? 'violet' : 'brand'}>
                {brief.state === 'pinned' ? 'Pinned' : 'Edited'}
              </Badge>
            ) : null}
          </div>
          {!editing ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy}
                icon={<Pencil className="size-4" aria-hidden />}
                onClick={() => {
                  setDraft({ summary: brief.summary, what_they_do: brief.what_they_do });
                  setEditing(true);
                }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                disabled={busy}
                loading={save.isPending && !editing}
                icon={
                  brief.state === 'pinned' ? (
                    <PinOff className="size-4" aria-hidden />
                  ) : (
                    <Pin className="size-4" aria-hidden />
                  )
                }
                onClick={() => save.mutate({ pinned: brief.state !== 'pinned' })}
              >
                {brief.state === 'pinned' ? 'Unpin' : 'Pin'}
              </Button>
              <Button
                size="sm"
                disabled={busy || brief.state === 'pinned'}
                title={brief.state === 'pinned' ? 'Unpin the brief to regenerate it' : undefined}
                loading={regenerate.isPending}
                icon={<RefreshCw className="size-4" aria-hidden />}
                onClick={startRegeneration}
              >
                Regenerate
              </Button>
            </div>
          ) : null}
        </div>

        {editing ? (
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(draft);
            }}
          >
            <Field label="What they do">
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={draft.what_they_do}
                  onChange={(e) => setDraft({ ...draft, what_they_do: e.target.value })}
                />
              )}
            </Field>
            <Field label="Summary">
              {(props) => (
                <Textarea
                  {...props}
                  rows={8}
                  value={draft.summary}
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={save.isPending}
                disabled={!draft.summary.trim() || !draft.what_they_do.trim()}
              >
                Save brief
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-4 text-sm leading-relaxed text-slate-700">
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                What they do
              </h3>
              <p className="mt-1">{brief.what_they_do}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Summary
              </h3>
              <p className="mt-1 whitespace-pre-line">{brief.summary}</p>
            </div>
            {brief.sources.length > 0 ? (
              <div>
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Sources cited
                </h3>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {brief.sources.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                      >
                        {hostname(url)}
                        {new URL(url).pathname !== '/' ? new URL(url).pathname : ''}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Research log</h2>
          <p className="text-sm text-slate-500">
            Pages discovered by ranking links on{' '}
            {research ? hostname(research.company_url) : 'the website'}. Failed and robots-blocked
            pages are listed honestly.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Page
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pages.map((page) => (
                <tr key={`${page.url}-${page.retrieved_at}`}>
                  <td className="max-w-md px-5 py-2">
                    <p className="truncate text-slate-800">
                      {page.title || new URL(page.url).pathname}
                    </p>
                    <p className="truncate text-xs text-slate-500">{page.url}</p>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{page.source_type}</td>
                  <td className="px-3 py-2">
                    <Badge tone={FETCH_TONES[page.fetch_status]}>
                      {page.fetch_status === 'ok'
                        ? 'read'
                        : page.http_status
                          ? `HTTP ${page.http_status}`
                          : page.fetch_status.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {publicResearch ? (
          <div className="border-t border-slate-100 px-5 py-4 text-sm">
            <h3 className="font-semibold text-slate-900">Public interview discussion</h3>
            {publicResearch.status === 'found' ? (
              <ul className="mt-2 space-y-2">
                {publicResearch.results.map((result) => (
                  <li key={result.url}>
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {result.title}
                    </a>
                    <p className="text-slate-600">{result.snippet}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-slate-600">
                {publicResearch.status === 'not_found'
                  ? 'No public discussion of this company’s interview process was found. Nothing was made up to fill the gap.'
                  : `Public search was unavailable${publicResearch.error ? `: ${publicResearch.error}` : '.'}`}
              </p>
            )}
          </div>
        ) : null}
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Replace your edited brief?"
        description="You have edited the company brief. Regenerating will replace your changes with a new brief written from the research."
        confirmLabel="Replace my edits"
        tone="danger"
        loading={regenerate.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => regenerate.mutate(true, { onSettled: () => setConfirming(false) })}
      />
    </div>
  );
}
