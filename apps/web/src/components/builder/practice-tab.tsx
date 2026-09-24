'use client';

import type { WeakReason } from '@prepforge/shared';
import { Play, Target } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
import { CATEGORY_LABELS } from '@/lib/labels';
import { useWeakSpots } from '@/lib/queries';
import { useBuilder } from './context';

const REASON_LABELS: Record<WeakReason, string> = {
  uncovered: 'No question',
  no_flashcard: 'No flashcard',
  low_confidence: 'Low confidence',
};

const linkButton =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium';

/** Weak Spots: readiness and weak areas, calculated by code from the user's own practice. */
export function PracticeTab() {
  const { id, kit } = useBuilder();
  const weakSpots = useWeakSpots(id);

  if (kit.flashcards.length === 0) {
    return (
      <EmptyState
        title="No flashcards to practise"
        description="Add flashcards on the Flashcards tab first."
      />
    );
  }
  if (weakSpots.isPending) return <Spinner />;
  if (weakSpots.isError) {
    return <EmptyState title="Could not load Weak Spots" description={weakSpots.error.message} />;
  }
  const report = weakSpots.data;
  const weak = report.requirements.filter((r) => r.weak);

  return (
    <div className="space-y-5">
      <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <div
          className="relative grid size-24 shrink-0 place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--color-brand-600) ${report.readiness * 3.6}deg, var(--color-slate-200) 0deg)`,
          }}
          role="img"
          aria-label={`Readiness ${report.readiness} percent`}
        >
          <div className="grid size-19 place-items-center rounded-full bg-white">
            <span className="text-xl font-semibold text-slate-900">{report.readiness}%</span>
          </div>
        </div>
        <div className="flex-1 space-y-1">
          <h2 className="text-base font-semibold text-slate-900">Readiness</h2>
          <p className="text-sm text-slate-600">
            {report.practiced_flashcards} of {report.total_flashcards} flashcards practised.{' '}
            {report.counts.low_confidence} requirement(s) with low confidence,{' '}
            {report.counts.uncovered} without a question, {report.counts.unpracticed} card(s) not
            yet practised.
          </p>
          <p className="text-xs text-slate-500">
            Must-have requirements count twice as much as nice-to-haves.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:w-48">
          <Link
            href={`/kits/${id}/practice`}
            className={`${linkButton} bg-brand-600 text-white hover:bg-brand-700`}
          >
            <Play className="size-4" aria-hidden /> Practise all
          </Link>
          <Link
            href={`/kits/${id}/practice?mode=weak`}
            aria-disabled={weak.length === 0}
            className={`${linkButton} bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 aria-disabled:pointer-events-none aria-disabled:opacity-50`}
          >
            <Target className="size-4" aria-hidden /> Practise weak areas
          </Link>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900">Weak requirements</h3>
          {weak.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">
              {report.practiced_flashcards === 0
                ? 'Practise a few flashcards to find your weak spots.'
                : 'No weak spots right now. Nice work.'}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {weak.map((r) => (
                <li key={r.id} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center">
                  <span className="w-8 font-mono text-xs text-slate-400">{r.id}</span>
                  <span className="flex-1 text-sm text-slate-800">{r.text}</span>
                  <span className="flex flex-wrap gap-1">
                    {r.priority === 'must' ? <Badge tone="brand">Must</Badge> : null}
                    {r.reasons.map((reason) => (
                      <Badge key={reason} tone={reason === 'low_confidence' ? 'red' : 'amber'}>
                        {REASON_LABELS[reason]}
                        {reason === 'low_confidence' && r.confidence !== null
                          ? ` · ${r.confidence}/5`
                          : ''}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900">Confidence by category</h3>
          <ul className="mt-3 space-y-3">
            {report.categories.map((category) => (
              <li key={category.category}>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>
                    {CATEGORY_LABELS[category.category]}
                    {report.weakest_categories.includes(category.category) ? (
                      <span className="ml-1 font-medium text-red-600">· weakest</span>
                    ) : null}
                  </span>
                  <span>
                    {category.confidence === null ? 'not practised' : `${category.confidence}/5`}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-600"
                    style={{
                      width: `${category.confidence === null ? 0 : (category.confidence / 5) * 100}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
