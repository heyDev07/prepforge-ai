'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { Alert, Badge, Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  BATCH_EXAMPLE,
  MAX_BATCH_FILE_BYTES,
  MAX_BATCH_ROWS,
  parseBatchFile,
  type BatchRow,
} from '@/lib/batch-file';
import { keys } from '@/lib/queries';

type RowStatus = 'ready' | 'invalid' | 'creating' | 'created' | 'duplicate' | 'failed';

interface RowState extends BatchRow {
  status: RowStatus;
  kitId?: string;
  message?: string;
}

const STATUS: Record<
  RowStatus,
  { label: string; tone: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }
> = {
  ready: { label: 'Ready', tone: 'neutral' },
  invalid: { label: 'Invalid', tone: 'red' },
  creating: { label: 'Creating…', tone: 'blue' },
  created: { label: 'Generating', tone: 'green' },
  duplicate: { label: 'Already exists', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
};

function downloadExample() {
  const blob = new Blob([JSON.stringify(BATCH_EXAMPLE, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'prepforge-roles.json';
  link.click();
  URL.revokeObjectURL(url);
}

/** Creates one kit per row of an uploaded file and starts generating each of them. */
export function BatchUpload() {
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const update = (index: number, patch: Partial<RowState>) =>
    setRows((current) => current.map((row) => (row.index === index ? { ...row, ...patch } : row)));

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow choosing the same file again after fixing it
    if (!file) return;
    setFileName(file.name);
    setFinished(false);
    setRows([]);
    if (file.size > MAX_BATCH_FILE_BYTES) {
      setFileError('The file is larger than 1 MB.');
      return;
    }
    const result = parseBatchFile(await file.text());
    if (!result.ok) {
      setFileError(result.error);
      return;
    }
    setFileError(null);
    setRows(result.rows.map((row) => ({ ...row, status: row.input ? 'ready' : 'invalid' })));
  }

  async function createAll() {
    setRunning(true);
    // one after another: the server queues generation jobs, and a failure stays on its row
    for (const row of rows) {
      if (row.status !== 'ready' || !row.input) continue;
      update(row.index, { status: 'creating' });
      try {
        const { kit } = await api.createKit(row.input);
        try {
          await api.generate(kit.id);
          update(row.index, { status: 'created', kitId: kit.id });
        } catch (error) {
          update(row.index, {
            status: 'failed',
            kitId: kit.id,
            message: `The kit was created but generation did not start: ${error instanceof ApiError ? error.message : 'unknown error'} Open it to retry.`,
          });
        }
      } catch (error) {
        if (error instanceof ApiError && error.code === 'DUPLICATE_KIT') {
          update(row.index, {
            status: 'duplicate',
            kitId: String(error.details?.existing_kit_id ?? ''),
            message: 'You already have a kit for this job and company.',
          });
        } else {
          update(row.index, {
            status: 'failed',
            message: error instanceof ApiError ? error.message : 'Could not create the kit.',
          });
        }
      }
    }
    await queryClient.invalidateQueries({ queryKey: keys.kits });
    setRunning(false);
    setFinished(true);
  }

  const ready = rows.filter((row) => row.status === 'ready').length;
  const created = rows.filter((row) => row.status === 'created').length;

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900">Upload several roles</h2>
        <p className="text-sm text-slate-600">
          A JSON file with up to {MAX_BATCH_ROWS} entries, each with <code>jd</code>,{' '}
          <code>company_url</code> and <code>days</code>: the same format as the batch command, so a
          cases file works here too. One kit is created and generated per entry.
        </p>
        <Button
          size="sm"
          variant="ghost"
          icon={<Download className="size-3.5" aria-hidden />}
          onClick={downloadExample}
        >
          Download an example file
        </Button>
      </div>

      <div>
        <label
          htmlFor="batch-file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand-500"
        >
          <FileUp className="size-6 text-slate-400" aria-hidden />
          <span className="text-sm font-medium text-slate-800">
            {fileName ? `Chosen: ${fileName} (choose another)` : 'Choose a .json file'}
          </span>
          <input
            id="batch-file"
            type="file"
            accept=".json,application/json"
            className="sr-only"
            disabled={running}
            onChange={(event) => void onFile(event)}
          />
        </label>
      </div>

      {fileError ? <Alert tone="red">{fileError}</Alert> : null}

      {rows.length > 0 ? (
        <ul
          className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200"
          aria-live="polite"
        >
          {rows.map((row) => (
            <li
              key={row.index}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {row.label} <span className="font-normal text-slate-500">· {row.company}</span>
                  {row.input ? (
                    <span className="font-normal text-slate-500"> · {row.input.days} day(s)</span>
                  ) : null}
                </p>
                {row.title ? <p className="truncate text-xs text-slate-500">{row.title}</p> : null}
                {row.error || row.message ? (
                  <p className="mt-1 text-xs text-slate-600">{row.error ?? row.message}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
                {row.kitId ? (
                  <Link
                    href={`/kits/${row.kitId}`}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    Open
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {finished ? (
        <Alert tone={created > 0 ? 'green' : 'amber'}>
          {created} kit(s) are being generated, one after another. You can leave this page: progress
          shows on the dashboard.
        </Alert>
      ) : null}

      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
        {finished ? (
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            Go to dashboard
          </Link>
        ) : (
          <Button
            variant="primary"
            loading={running}
            disabled={ready === 0}
            icon={<Sparkles className="size-4" aria-hidden />}
            onClick={() => void createAll()}
          >
            {ready > 0 ? `Create and generate ${ready} kit(s)` : 'Create and generate'}
          </Button>
        )}
      </div>
    </Card>
  );
}
