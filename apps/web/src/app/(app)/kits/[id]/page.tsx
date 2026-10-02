'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Suspense, use, useEffect } from 'react';
import { KitBuilder } from '@/components/builder/kit-builder';
import { CompanyAvatar } from '@/components/company-avatar';
import { JobError, StageList } from '@/components/generation-progress';
import { Card, EmptyState, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { hostname } from '@/lib/labels';
import { keys, useGenerationStatus, useKit, useStartJob } from '@/lib/queries';

export default function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const kit = useKit(id);

  if (kit.isPending) return <Spinner label="Loading kit…" />;
  if (kit.isError) {
    return (
      <EmptyState
        title={kit.error.status === 404 ? 'Kit not found' : 'Could not load this kit'}
        description={
          kit.error.status === 404
            ? 'It may have been deleted, or it belongs to another account.'
            : kit.error.message
        }
        action={
          <Link href="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
            Back to dashboard
          </Link>
        }
      />
    );
  }

  const detail = kit.data;
  if (!detail.kit) return <GenerationView id={id} />;
  return (
    <Suspense fallback={<Spinner />}>
      <KitBuilder detail={detail} kit={detail.kit} />
    </Suspense>
  );
}

/** Shown until the kit exists: live stage-by-stage progress, errors and retry. */
function GenerationView({ id }: { id: string }) {
  const kit = useKit(id);
  const status = useGenerationStatus(id, true);
  const retry = useStartJob(id, () => api.generate(id), 'Generation restarted.');
  const job = status.data?.job ?? kit.data?.latest_job ?? null;
  const input = kit.data?.input;

  // The job can finish while an older copy of the kit (still without content) is loading.
  // Keep reloading the kit until its content arrives, so this view never gets stuck.
  const queryClient = useQueryClient();
  const jobDone = status.data?.job?.status === 'completed';
  const kitMissing = Boolean(kit.data && !kit.data.kit);
  const kitLoading = kit.isFetching;
  useEffect(() => {
    if (!jobDone || !kitMissing || kitLoading) return;
    const timer = setTimeout(() => {
      // let a slow reload finish instead of restarting it
      void queryClient.invalidateQueries(
        { queryKey: keys.kit(id), exact: true },
        { cancelRefetch: false },
      );
    }, 1_500);
    return () => clearTimeout(timer);
  }, [id, jobDone, kitLoading, kitMissing, queryClient]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Dashboard
      </Link>
      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div
          aria-hidden
          className="absolute -top-20 -right-16 size-56 rounded-full bg-brand-200/40 blur-3xl"
        />
        <div className="relative flex items-start gap-4">
          {input ? <CompanyAvatar name={hostname(input.company_url)} /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              {job?.status === 'failed' ? 'Generation stopped' : 'Building your prep kit'}
            </h1>
            {input ? (
              <p className="mt-1 text-sm text-slate-600">
                {hostname(input.company_url)} · {input.days} {input.days === 1 ? 'day' : 'days'} ·
                each stage runs separately, and coverage and scheduling are checked by code.
              </p>
            ) : null}
          </div>
          {job && job.status !== 'failed' ? (
            <span className="font-display text-2xl font-bold text-brand-600 tabular-nums">
              {job.progress}%
            </span>
          ) : null}
        </div>
        {job && job.status !== 'failed' ? (
          <div className="relative mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-300 via-brand-500 to-brand-600 transition-all duration-700"
              style={{ width: `${Math.max(4, job.progress)}%` }}
            />
          </div>
        ) : null}
      </Card>

      {job ? (
        <JobError job={job} onRetry={() => retry.mutate(undefined)} retrying={retry.isPending} />
      ) : null}

      <Card className="p-4 sm:p-6">
        {job ? (
          <StageList job={job} />
        ) : (
          <div className="space-y-3 text-sm text-slate-600">
            <p>This kit has not been generated yet.</p>
            <button
              type="button"
              onClick={() => retry.mutate(undefined)}
              className="font-medium text-brand-700 hover:underline"
            >
              Start generation
            </button>
          </div>
        )}
      </Card>
      <p className="text-center text-xs text-slate-500" aria-live="polite">
        {job?.status === 'running' || job?.status === 'queued'
          ? 'You can leave this page. Generation continues on the server.'
          : null}
      </p>
    </div>
  );
}
