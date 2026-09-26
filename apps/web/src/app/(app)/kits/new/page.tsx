'use client';

import { MAX_DAYS, MAX_JD_CHARS, MIN_DAYS, MIN_JD_CHARS } from '@prepforge/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BatchUpload } from '@/components/batch-upload';
import { Alert, Button, Card, cx, Field, Input, Textarea } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { keys } from '@/lib/queries';

export default function NewKitPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [days, setDays] = useState('5');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [mode, setMode] = useState<'single' | 'upload'>('single');

  async function create(allowDuplicate = false) {
    setPending(true);
    setError(null);
    try {
      const { kit } = await api.createKit({
        jd,
        company_url: companyUrl.trim(),
        days: Number(days),
        allow_duplicate: allowDuplicate || undefined,
      });
      await api.generate(kit.id);
      await queryClient.invalidateQueries({ queryKey: keys.kits });
      router.push(`/kits/${kit.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void create();
  }

  const fields = error?.fieldErrors ?? {};
  const duplicateId =
    error?.code === 'DUPLICATE_KIT' ? String(error.details?.existing_kit_id ?? '') : null;
  const jdLength = jd.trim().length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">New prep kit</h1>
        <p className="mt-1 text-sm text-slate-600">
          PrepForge extracts the requirements from the job description, researches the company, and
          builds questions, flashcards and a schedule. Nothing is invented: every requirement comes
          from the text you paste.
        </p>
      </div>

      <div
        role="group"
        aria-label="How to add roles"
        className="flex w-fit rounded-md bg-slate-100 p-0.5"
      >
        {(
          [
            ['single', 'One role'],
            ['upload', 'Upload a file'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cx(
              'rounded px-3 py-1.5 text-sm font-medium',
              mode === value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'upload' ? <BatchUpload /> : null}

      {mode === 'single' && duplicateId ? (
        <Alert
          tone="blue"
          title="You already have a kit for this job and company"
          action={
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/kits/${duplicateId}`}
                className="inline-flex h-8 items-center rounded-md bg-white px-2.5 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                Open it
              </Link>
              <Button
                size="sm"
                variant="primary"
                loading={pending}
                onClick={() => void create(true)}
              >
                Create another
              </Button>
            </div>
          }
        >
          Open the existing kit to keep your edits, or create a separate copy.
        </Alert>
      ) : mode === 'single' && error && Object.keys(fields).length === 0 ? (
        <Alert tone="red">{error.message}</Alert>
      ) : null}

      <Card className={cx('p-5 sm:p-6', mode !== 'single' && 'hidden')}>
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <Field
            label="Job description"
            error={fields.jd}
            hint={`${jdLength.toLocaleString()} / ${MAX_JD_CHARS.toLocaleString()} characters. Paste the full posting, including requirements.`}
          >
            {(props) => (
              <Textarea
                {...props}
                required
                rows={12}
                minLength={MIN_JD_CHARS}
                maxLength={MAX_JD_CHARS}
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                placeholder="Senior Backend Engineer…&#10;&#10;Requirements&#10;- 5+ years of Node.js…"
                className="font-mono text-[13px] leading-relaxed"
              />
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
            <Field
              label="Company website"
              error={fields.company_url}
              hint="The company's homepage, e.g. https://acme.com"
            >
              {(props) => (
                <Input
                  {...props}
                  type="url"
                  inputMode="url"
                  required
                  placeholder="https://"
                  value={companyUrl}
                  onChange={(e) => setCompanyUrl(e.target.value)}
                />
              )}
            </Field>
            <Field label="Days until interview" error={fields.days}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  inputMode="numeric"
                  min={MIN_DAYS}
                  max={MAX_DAYS}
                  required
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Cancel
            </Link>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              disabled={jdLength < MIN_JD_CHARS || !companyUrl.trim() || !days}
              icon={<Sparkles className="size-4" aria-hidden />}
            >
              Create and generate
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
