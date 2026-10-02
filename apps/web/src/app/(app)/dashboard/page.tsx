'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  FileQuestion,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CompanyAvatar } from '@/components/company-avatar';
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

  const list = kits.data?.kits ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs font-medium tracking-widest text-brand-600 uppercase">
            Dashboard
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Your prep kits
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Each kit is built from a job description and research on the company.
          </p>
        </div>
        <Link href="/kits/new" className={NEW_KIT_LINK}>
          <Plus className="size-4" aria-hidden /> New kit
        </Link>
      </div>

      {list.length > 0 ? <Summary kits={list} /> : null}

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
          icon={<Briefcase className="size-7" aria-hidden />}
          title="No kits yet"
          description="Paste a job description and the company's website to build your first interview-prep kit."
          action={
            <Link href="/kits/new" className={NEW_KIT_LINK}>
              <Plus className="size-4" aria-hidden /> Create a kit
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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

const NEW_KIT_LINK =
  'inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-4 text-sm font-semibold text-white shadow-ember transition hover:from-brand-600 hover:to-brand-700';

function Summary({ kits }: { kits: KitSummaryDto[] }) {
  const ready = kits.filter((k) => k.status === 'ready' || k.status === 'ready_with_gaps').length;
  const stats = [
    { label: 'Kits', value: kits.length, icon: Briefcase },
    { label: 'Ready to practise', value: ready, icon: CheckCircle2 },
    { label: 'Questions', value: kits.reduce((n, k) => n + k.questions, 0), icon: FileQuestion },
    { label: 'Flashcards', value: kits.reduce((n, k) => n + k.flashcards, 0), icon: Layers },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map(({ label, value, icon: Icon }) => (
        <Card key={label} className="flex items-center gap-4 p-4">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col-reverse">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-display text-2xl font-bold text-slate-900 tabular-nums">{value}</dd>
          </div>
        </Card>
      ))}
    </dl>
  );
}

function KitCard({ kit, onDelete }: { kit: KitSummaryDto; onDelete: () => void }) {
  const job = kit.latest_job;
  const generating =
    kit.status === 'generating' || job?.status === 'queued' || job?.status === 'running';
  return (
    <Card className="group relative flex h-full flex-col p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-lift hover:ring-brand-200">
      <div className="flex items-start gap-3">
        <CompanyAvatar name={kit.company} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-semibold text-slate-900">
            <Link
              href={`/kits/${kit.id}`}
              className="after:absolute after:inset-0 after:rounded-xl focus:outline-none"
            >
              {kit.company}
            </Link>
          </h2>
          <p className="truncate text-sm text-slate-600">{kit.role ?? hostname(kit.company_url)}</p>
        </div>
        <ArrowUpRight
          className="size-4 shrink-0 text-slate-300 transition group-hover:text-brand-500"
          aria-hidden
        />
      </div>

      <div className="mt-4">
        <Badge tone={STATUS_TONES[kit.status]}>{STATUS_LABELS[kit.status]}</Badge>
      </div>

      {generating && job ? (
        <div className="mt-4 space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all"
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

      <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 text-center">
        {[
          { label: kit.days === 1 ? 'day' : 'days', value: kit.days, icon: CalendarDays },
          { label: 'questions', value: kit.questions, icon: FileQuestion },
          { label: 'cards', value: kit.flashcards, icon: Layers },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex flex-col-reverse">
            <dt className="text-[11px] text-slate-500">{label}</dt>
            <dd className="flex items-center justify-center gap-1 font-display text-base font-semibold text-slate-900 tabular-nums">
              <Icon className="size-3.5 text-slate-400" aria-hidden />
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
        <span>Created {formatDate(kit.created_at)}</span>
        <button
          type="button"
          onClick={onDelete}
          disabled={generating}
          aria-label={`Delete kit for ${kit.company}`}
          className="relative z-10 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-red-600 disabled:hidden"
        >
          <Trash2 className="size-3.5" aria-hidden /> Delete
        </button>
      </div>
    </Card>
  );
}
