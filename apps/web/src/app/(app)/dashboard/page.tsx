'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, CalendarDays, FileQuestion, Layers, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Spinner } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { formatDate, hostname, stageLabel, STATUS_LABELS, STATUS_TONES } from '@/lib/labels';
import { keys, useKits } from '@/lib/queries';
import type { KitSummaryDto } from '@prepforge/shared';

export default function DashboardPage() {
  const kits = useKits();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [toDelete, setToDelete] = useState<KitSummaryDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteKit(toDelete.id);
      await queryClient.invalidateQueries({ queryKey: keys.kits });
      toast('Kit deleted.');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not delete the kit.', 'error');
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Your prep kits</h1>
          <p className="mt-1 text-sm text-slate-600">
            Each kit is built from a job description and research on the company.
          </p>
        </div>
        <Link
          href="/kits/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="size-4" aria-hidden /> New kit
        </Link>
      </div>

      {kits.isPending ? (
        <Spinner label="Loading your kits…" />
      ) : kits.isError ? (
        <EmptyState
          title="Could not load your kits"
          description={kits.error.message}
          action={<Button onClick={() => void kits.refetch()}>Try again</Button>}
        />
      ) : kits.data.kits.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="size-10" aria-hidden />}
          title="No kits yet"
          description="Paste a job description and the company's website to build your first interview-prep kit."
          action={
            <Link
              href="/kits/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              <Plus className="size-4" aria-hidden /> Create a kit
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kits.data.kits.map((kit) => (
            <li key={kit.id}>
              <KitCard kit={kit} onDelete={() => setToDelete(kit)} />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this kit?"
        description={
          <>
            <strong>{toDelete?.company}</strong> — {toDelete?.role ?? 'untitled role'}. Its
            questions, flashcards and practice history will be removed permanently.
          </>
        }
        confirmLabel="Delete kit"
        tone="danger"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function KitCard({ kit, onDelete }: { kit: KitSummaryDto; onDelete: () => void }) {
  const job = kit.latest_job;
  const generating =
    kit.status === 'generating' || job?.status === 'queued' || job?.status === 'running';
  return (
    <Card className="group relative flex h-full flex-col p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900">
            <Link
              href={`/kits/${kit.id}`}
              className="after:absolute after:inset-0 focus:outline-none"
            >
              {kit.company}
            </Link>
          </h2>
          <p className="truncate text-sm text-slate-600">{kit.role ?? hostname(kit.company_url)}</p>
        </div>
        <Badge tone={STATUS_TONES[kit.status]}>{STATUS_LABELS[kit.status]}</Badge>
      </div>

      {generating && job ? (
        <div className="mt-4 space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{ width: `${Math.max(5, job.progress)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {job.current_stage
              ? stageLabel(job.current_stage, job.progress > 70 ? 1 : 0)
              : 'Queued'}
            …
          </p>
        </div>
      ) : null}

      <dl className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4 text-xs text-slate-500">
        <div className="flex items-center gap-1">
          <CalendarDays className="size-3.5" aria-hidden />
          <dt className="sr-only">Days</dt>
          <dd>
            {kit.days} {kit.days === 1 ? 'day' : 'days'}
          </dd>
        </div>
        <div className="flex items-center gap-1">
          <FileQuestion className="size-3.5" aria-hidden />
          <dt className="sr-only">Questions</dt>
          <dd>{kit.questions} questions</dd>
        </div>
        <div className="flex items-center gap-1">
          <Layers className="size-3.5" aria-hidden />
          <dt className="sr-only">Flashcards</dt>
          <dd>{kit.flashcards} cards</dd>
        </div>
        <div>
          <dt className="sr-only">Created</dt>
          <dd>{formatDate(kit.created_at)}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onDelete}
        disabled={generating}
        aria-label={`Delete kit for ${kit.company}`}
        className="relative z-10 mt-3 inline-flex w-fit items-center gap-1 rounded text-xs text-slate-400 hover:text-red-600 disabled:hidden"
      >
        <Trash2 className="size-3.5" aria-hidden /> Delete
      </button>
    </Card>
  );
}
