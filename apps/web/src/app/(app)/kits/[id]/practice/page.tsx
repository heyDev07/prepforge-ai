'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, Target } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, cx, EmptyState, Spinner } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { keys, useKit, useWeakSpots } from '@/lib/queries';

const CONFIDENCE = [
  { value: 1, label: 'No idea' },
  { value: 2, label: 'Shaky' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Nailed it' },
];

export default function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Spinner />}>
      <PracticeSession id={id} />
    </Suspense>
  );
}

function PracticeSession({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'weak' ? 'weak' : 'all';
  const kit = useKit(id);
  const weakSpots = useWeakSpots(id, Boolean(kit.data?.kit));
  const queryClient = useQueryClient();
  const toast = useToast();
  const [exclude, setExclude] = useState<string | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [saving, setSaving] = useState(false);

  const next = useQuery({
    queryKey: ['kit', id, 'practice-next', mode, exclude ?? ''],
    queryFn: () => api.practiceNext(id, mode, exclude),
    enabled: Boolean(kit.data?.kit),
    staleTime: 0,
  });
  const card = next.data?.flashcard ?? null;

  const loadingNext = next.isFetching;

  const rate = useCallback(
    async (confidence: number) => {
      if (!card || saving) return;
      setSaving(true);
      try {
        await api.recordPractice(id, card.id, confidence);
        setSessionCount((n) => n + 1);
        // drop cached "next card" results so the card just answered is never shown again
        queryClient.removeQueries({ queryKey: ['kit', id, 'practice-next'] });
        setExclude(card.id);
        setRevealed(false);
        void queryClient.invalidateQueries({ queryKey: keys.weakSpots(id) });
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'Could not save your answer.', 'error');
      } finally {
        setSaving(false);
      }
    },
    [card, id, queryClient, saving, toast],
  );

  // keyboard: Space/Enter reveals, 1–5 rates
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target.tagName)
      ) {
        return;
      }
      if (saving || loadingNext || !card) return;
      if (!revealed && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed && /^[1-5]$/.test(event.key)) {
        void rate(Number(event.key));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, rate, saving, loadingNext, card]);

  if (kit.isPending || (next.isPending && kit.data?.kit)) {
    return <Spinner label="Preparing practice…" />;
  }
  if (kit.isError) {
    return <EmptyState title="Could not load this kit" description={kit.error.message} />;
  }
  if (!kit.data.kit) {
    return (
      <EmptyState
        title="This kit is not ready yet"
        action={
          <Link href={`/kits/${id}`} className="text-sm font-medium text-brand-700 hover:underline">
            Back to kit
          </Link>
        }
      />
    );
  }

  const requirements = new Map(kit.data.kit.role.requirements.map((r) => [r.id, r]));
  const report = weakSpots.data;
  const total = report?.total_flashcards ?? kit.data.kit.flashcards.length;
  const practised = report?.practiced_flashcards ?? 0;

  function switchMode(value: 'all' | 'weak') {
    setExclude(undefined);
    setRevealed(false);
    router.replace(`/kits/${id}/practice${value === 'weak' ? '?mode=weak' : ''}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/kits/${id}?tab=practice`}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" aria-hidden /> {kit.data.kit.source.company}
        </Link>
        <div role="group" aria-label="Practice mode" className="flex rounded-md bg-slate-100 p-0.5">
          {(['all', 'weak'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => switchMode(value)}
              className={cx(
                'rounded px-3 py-1 text-sm font-medium',
                mode === value
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {value === 'all' ? 'All cards' : 'Weak areas'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>
            {practised} of {total} cards practised · {sessionCount} answered this session
          </span>
          {report ? <span>Readiness {report.readiness}%</span> : null}
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={practised}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Cards practised"
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${total ? (practised / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {loadingNext ? (
        <Card className="p-8">
          <Spinner label="Loading the next card…" />
        </Card>
      ) : !card ? (
        <EmptyState
          icon={<Target className="size-10" aria-hidden />}
          title={mode === 'weak' ? 'No weak areas right now' : 'No flashcards to practise'}
          description={
            mode === 'weak'
              ? 'Every requirement you have practised is at a comfortable confidence.'
              : 'Add flashcards to this kit first.'
          }
          action={
            mode === 'weak' ? (
              <Button onClick={() => switchMode('all')}>Practise all cards</Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="space-y-4 p-6 sm:p-8">
            <div className="flex flex-wrap gap-1.5">
              {card.requirement_ids.map((rid) => (
                <Badge key={rid} tone="brand" title={requirements.get(rid)?.text}>
                  {requirements.get(rid)?.text ?? rid}
                </Badge>
              ))}
              {next.data?.stats?.confidence !== null &&
              next.data?.stats?.confidence !== undefined ? (
                <Badge>Last confidence {next.data.stats.last_confidence}/5</Badge>
              ) : (
                <Badge tone="blue">New</Badge>
              )}
            </div>
            <p className="text-lg font-medium text-slate-900" aria-live="polite">
              {card.front}
            </p>
            {revealed ? (
              <div className="rounded-md bg-slate-50 p-4 text-sm whitespace-pre-line text-slate-700">
                {card.back}
              </div>
            ) : null}
          </div>
          <div className="border-t border-slate-100 bg-slate-50 p-4">
            {!revealed ? (
              <Button
                variant="primary"
                className="w-full"
                icon={<Eye className="size-4" aria-hidden />}
                onClick={() => setRevealed(true)}
              >
                Reveal answer <span className="hidden text-white/70 sm:inline">(Space)</span>
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-center text-sm font-medium text-slate-700" id="confidence-label">
                  How confident were you?
                </p>
                <div
                  role="group"
                  aria-labelledby="confidence-label"
                  className="grid grid-cols-5 gap-2"
                >
                  {CONFIDENCE.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      disabled={saving}
                      onClick={() => void rate(value)}
                      className="flex flex-col items-center rounded-md bg-white px-1 py-2 text-slate-800 ring-1 ring-slate-300 hover:bg-brand-50 hover:ring-brand-300 disabled:opacity-50"
                    >
                      <span className="text-base font-semibold">{value}</span>
                      <span className="text-[11px] text-slate-500">{label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-center text-xs text-slate-500">
                  Press 1–5 to answer. Weakest cards come back first.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
