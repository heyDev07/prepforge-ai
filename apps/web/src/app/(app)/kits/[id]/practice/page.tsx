'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WeakSpotsReport } from '@prepforge/shared';
import { ArrowLeft, CheckCircle2, Eye, RotateCcw, Target } from 'lucide-react';
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

type Mode = 'all' | 'weak';

/** Progress through one round of a mode; scores themselves live on the server. */
interface Round {
  answered: string[];
  ratings: number[];
  startReadiness: number | null;
  last?: string;
}

const EMPTY_ROUND: Round = { answered: [], ratings: [], startReadiness: null };
const roundKey = (id: string, mode: Mode) => `prepforge:practice:${id}:${mode}`;
const currentKey = (id: string, mode: Mode) => `${roundKey(id, mode)}:current`;

// Rounds are remembered per browser so switching modes or leaving the page resumes them.
// Storage can be unavailable (private windows, blocked site data): practice still works.
function readStorage<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered, which only means a later visit starts a fresh round
  }
}

function loadRound(id: string, mode: Mode): Round {
  const saved = readStorage<Round>(roundKey(id, mode));
  return saved && Array.isArray(saved.answered) && Array.isArray(saved.ratings)
    ? { ...EMPTY_ROUND, ...saved }
    : EMPTY_ROUND;
}

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
  const mode: Mode = searchParams.get('mode') === 'weak' ? 'weak' : 'all';
  const kit = useKit(id);
  const weakSpots = useWeakSpots(id, Boolean(kit.data?.kit));
  const queryClient = useQueryClient();
  const toast = useToast();
  // a round shows every card in the mode once, weakest first, and then ends;
  // each mode keeps its own round, so switching between them resumes where you were
  const [rounds, setRounds] = useState<Record<Mode, Round>>(() => ({
    all: loadRound(id, 'all'),
    weak: loadRound(id, 'weak'),
  }));
  const round = rounds[mode];
  const { answered, ratings } = round;
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);

  const updateRound = useCallback(
    (target: Mode, change: (current: Round) => Round) =>
      setRounds((previous) => {
        const updated = change(previous[target]);
        writeStorage(roundKey(id, target), updated);
        return { ...previous, [target]: updated };
      }),
    [id],
  );

  const next = useQuery({
    queryKey: ['kit', id, 'practice-next', mode, answered.join(','), round.last ?? ''],
    queryFn: () =>
      api.practiceNext(
        id,
        mode,
        answered,
        round.last,
        readStorage<string>(currentKey(id, mode)) ?? undefined,
      ),
    enabled: Boolean(kit.data?.kit),
    staleTime: 0,
  });
  const card = next.data?.flashcard ?? null;

  // remember the card on screen so coming back shows the same question
  const cardId = card?.id;
  useEffect(() => {
    if (cardId) writeStorage(currentKey(id, mode), cardId);
  }, [cardId, id, mode]);

  const loadingNext = next.isFetching;
  const currentReadiness = weakSpots.data?.readiness ?? null;

  const rate = useCallback(
    async (confidence: number) => {
      if (!card || saving) return;
      setSaving(true);
      try {
        const startReadiness = answered.length === 0 ? currentReadiness : round.startReadiness;
        await api.recordPractice(id, card.id, confidence);
        // drop cached "next card" results so the card just answered is never shown again
        queryClient.removeQueries({ queryKey: ['kit', id, 'practice-next'] });
        updateRound(mode, (current) => ({
          answered: [...current.answered, card.id],
          ratings: [...current.ratings, confidence],
          startReadiness,
          last: card.id,
        }));
        setRevealed(false);
        void queryClient.invalidateQueries({ queryKey: keys.weakSpots(id) });
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'Could not save your answer.', 'error');
      } finally {
        setSaving(false);
      }
    },
    [
      answered.length,
      card,
      currentReadiness,
      id,
      mode,
      queryClient,
      round.startReadiness,
      saving,
      toast,
      updateRound,
    ],
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
  const roundSize = answered.length + (next.data?.remaining ?? 0);
  const roundComplete = !card && answered.length > 0;
  const hasWeakCards = Boolean(report?.requirements.some((r) => r.weak && r.flashcards > 0));

  /** Starts this mode's round again from the weakest card; scores are not touched. */
  function restartRound() {
    writeStorage(currentKey(id, mode), null);
    queryClient.removeQueries({ queryKey: ['kit', id, 'practice-next', mode] });
    updateRound(mode, (current) => ({ ...EMPTY_ROUND, last: current.last }));
    setRevealed(false);
  }

  function switchMode(value: Mode) {
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
        <div className="flex justify-between gap-3 text-xs text-slate-500">
          <span>
            {roundComplete
              ? `Round complete · ${answered.length} card(s)`
              : roundSize > 0
                ? `Card ${answered.length + 1} of ${roundSize} in this round`
                : 'No cards in this round'}{' '}
            · {practised} of {total} practised overall
          </span>
          {report ? <span>Readiness {report.readiness}%</span> : null}
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={answered.length}
          aria-valuemin={0}
          aria-valuemax={roundSize}
          aria-label="Cards answered in this round"
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${roundSize ? (answered.length / roundSize) * 100 : 0}%` }}
          />
        </div>
        {answered.length > 0 && !roundComplete ? (
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-3.5" aria-hidden />}
              title="Start this round again from the weakest card. Your scores are kept."
              onClick={restartRound}
            >
              Restart round
            </Button>
          </div>
        ) : null}
      </div>

      {loadingNext ? (
        <Card className="p-8">
          <Spinner label="Loading the next card…" />
        </Card>
      ) : roundComplete ? (
        <RoundSummary
          id={id}
          mode={mode}
          ratings={ratings}
          startReadiness={round.startReadiness}
          report={report}
          hasWeakCards={hasWeakCards}
          onNextRound={restartRound}
          onWeakAreas={() => switchMode('weak')}
        />
      ) : !card ? (
        <EmptyState
          icon={<Target className="size-10" aria-hidden />}
          title={mode === 'weak' ? 'No weak areas to practise' : 'No flashcards to practise'}
          description={
            mode === 'weak'
              ? report?.requirements.some((r) => r.weak)
                ? 'Your weak requirements have no flashcards yet. Add one on the Flashcards tab to practise them.'
                : 'Every requirement you have practised is at a comfortable confidence.'
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

function RoundSummary({
  id,
  mode,
  ratings,
  startReadiness,
  report,
  hasWeakCards,
  onNextRound,
  onWeakAreas,
}: {
  id: string;
  mode: 'all' | 'weak';
  ratings: number[];
  startReadiness: number | null;
  report: WeakSpotsReport | undefined;
  hasWeakCards: boolean;
  onNextRound: () => void;
  onWeakAreas: () => void;
}) {
  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  const weak = report?.requirements.filter((r) => r.weak) ?? [];

  return (
    <Card className="space-y-5 p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-600" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Round complete</h2>
          <p className="text-sm text-slate-600">
            You answered {ratings.length} card(s) with an average rating of {average.toFixed(1)}/5.
            {report && startReadiness !== null
              ? ` Readiness went from ${startReadiness}% to ${report.readiness}%.`
              : ''}
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Weak areas</h3>
        {weak.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">
            None. Every requirement you have practised is at 3/5 or above.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {weak.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span className="flex-1">{r.text}</span>
                <Badge tone={r.reasons.includes('low_confidence') ? 'red' : 'amber'}>
                  {r.reasons.includes('low_confidence')
                    ? `Low confidence · ${r.confidence}/5`
                    : r.reasons.includes('no_flashcard')
                      ? 'No flashcard'
                      : 'No question'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="primary"
          icon={<RotateCcw className="size-4" aria-hidden />}
          onClick={onNextRound}
        >
          Start another round
        </Button>
        {mode === 'all' && hasWeakCards ? (
          <Button icon={<Target className="size-4" aria-hidden />} onClick={onWeakAreas}>
            Practise weak areas
          </Button>
        ) : null}
        <Link
          href={`/kits/${id}?tab=practice`}
          className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Back to kit
        </Link>
      </div>
    </Card>
  );
}
