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
  const all = rows(job);
  return (
    <ol className="relative" aria-label="Generation progress">
      {all.map((row, index) => {
        const { icon: Icon, className, text } = ICONS[row.status];
        const last = index === all.length - 1;
        return (
          <li
            key={row.key}
            className="relative flex gap-4 pb-1"
            aria-current={row.status === 'running' ? 'step' : undefined}
          >
            {!last ? (
              <span
                aria-hidden
                className={cx(
                  'absolute top-8 bottom-0 left-[15px] w-px',
                  row.status === 'completed' || row.status === 'skipped'
                    ? 'bg-emerald-200'
                    : 'bg-slate-200',
                )}
              />
            ) : null}
            <span
              className={cx(
                'relative z-10 mt-1 grid size-[31px] shrink-0 place-items-center rounded-full ring-1',
                row.status === 'completed' && 'bg-emerald-50 ring-emerald-200',
                row.status === 'running' &&
                  'bg-brand-50 ring-brand-300 shadow-[0_0_0_4px_rgb(251_146_60/0.15)]',
                row.status === 'pending' && 'bg-white ring-slate-200',
                row.status === 'failed' && 'bg-red-50 ring-red-200',
                row.status === 'skipped' && 'bg-slate-50 ring-slate-200',
              )}
            >
              <Icon className={cx('size-4', className)} aria-hidden />
            </span>
            <div
              className={cx(
                'min-w-0 flex-1 rounded-lg px-3 py-2 text-sm',
                row.status === 'running' && 'bg-brand-50/70',
                row.status === 'failed' && 'bg-red-50',
              )}
            >
              <p
                className={cx(
                  'font-medium',
                  row.status === 'pending' ? 'text-slate-400' : 'text-slate-800',
                )}
              >
                {stageLabel(row.stage, row.occurrence)}
                <span className="sr-only"> — {text}</span>
              </p>
              {row.detail ? <p className="mt-0.5 text-xs text-slate-500">{row.detail}</p> : null}
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
