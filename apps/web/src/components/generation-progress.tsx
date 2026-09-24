'use client';

import {
  PIPELINE_STAGE_SEQUENCE,
  type GenerationJob,
  type GenerationStage,
  type StageLogEntry,
} from '@prepforge/shared';
import { CheckCircle2, Circle, Loader2, MinusCircle, RotateCcw, XCircle } from 'lucide-react';
import { Alert, Button, cx } from '@/components/ui';
import { stageLabel } from '@/lib/labels';

type RowStatus = 'completed' | 'running' | 'pending' | 'failed' | 'skipped';

const ICONS: Record<RowStatus, { icon: typeof Circle; className: string; text: string }> = {
  completed: { icon: CheckCircle2, className: 'text-emerald-600', text: 'done' },
  running: { icon: Loader2, className: 'animate-spin text-brand-600', text: 'in progress' },
  pending: { icon: Circle, className: 'text-slate-300', text: 'waiting' },
  failed: { icon: XCircle, className: 'text-red-600', text: 'failed' },
  skipped: { icon: MinusCircle, className: 'text-slate-400', text: 'skipped' },
};

interface Row {
  key: string;
  stage: GenerationStage;
  occurrence: number;
  status: RowStatus;
  detail: string | null;
}

/** Aligns the job's stage log with the stages it is expected to pass through. */
function rows(job: GenerationJob): Row[] {
  const log: StageLogEntry[] = job.stage_log;
  const expected: GenerationStage[] =
    job.type === 'generate' ? [...PIPELINE_STAGE_SEQUENCE] : log.map((entry) => entry.stage);
  const seen = new Map<GenerationStage, number>();
  return expected.map((stage, index) => {
    const occurrence = seen.get(stage) ?? 0;
    seen.set(stage, occurrence + 1);
    const entry = log[index];
    let status: RowStatus = entry ? (entry.status as RowStatus) : 'pending';
    if (status === 'running' && job.status === 'failed') status = 'failed';
    if (job.status === 'completed' && stage === 'completed') status = 'completed';
    return { key: `${stage}-${index}`, stage, occurrence, status, detail: entry?.detail ?? null };
  });
}

export function StageList({ job }: { job: GenerationJob }) {
  return (
    <ol className="space-y-1" aria-label="Generation progress">
      {rows(job).map((row) => {
        const { icon: Icon, className, text } = ICONS[row.status];
        return (
          <li
            key={row.key}
            className={cx(
              'flex items-start gap-3 rounded-md px-2 py-1.5',
              row.status === 'running' && 'bg-brand-50',
              row.status === 'failed' && 'bg-red-50',
            )}
            aria-current={row.status === 'running' ? 'step' : undefined}
          >
            <Icon className={cx('mt-0.5 size-4 shrink-0', className)} aria-hidden />
            <div className="min-w-0 text-sm">
              <p className={cx(row.status === 'pending' ? 'text-slate-400' : 'text-slate-800')}>
                {stageLabel(row.stage, row.occurrence)}
                <span className="sr-only"> — {text}</span>
              </p>
              {row.detail ? <p className="text-xs text-slate-500">{row.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function JobError({
  job,
  onRetry,
  retrying,
}: {
  job: GenerationJob;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (!job.error) return null;
  const hint =
    job.error.code === 'LLM_NOT_CONFIGURED'
      ? 'The server has no working LLM API key configured.'
      : job.error.code === 'COMPANY_UNREACHABLE'
        ? 'Check the company URL. The website must be reachable for research.'
        : job.error.code === 'INSUFFICIENT_JD'
          ? 'Create a new kit with a job description that lists the skills or experience required.'
          : null;
  return (
    <Alert
      tone="red"
      title="Generation failed"
      action={
        onRetry && job.error.retryable ? (
          <Button
            size="sm"
            onClick={onRetry}
            loading={retrying}
            icon={<RotateCcw className="size-4" aria-hidden />}
          >
            Try again
          </Button>
        ) : null
      }
    >
      <p>{job.error.message}</p>
      {hint ? <p className="text-red-800/80">{hint}</p> : null}
      <p className="font-mono text-xs text-red-800/70">
        {job.error.code}
        {job.error.stage ? ` · ${job.error.stage}` : ''}
      </p>
    </Alert>
  );
}
