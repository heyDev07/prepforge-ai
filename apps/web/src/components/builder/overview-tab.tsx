'use client';

import { QUESTION_CATEGORIES } from '@prepforge/shared';
import { Info, TriangleAlert } from 'lucide-react';
import { Alert, Card } from '@/components/ui';
import { CATEGORY_LABELS } from '@/lib/labels';
import { useWeakSpots } from '@/lib/queries';
import { useBuilder, useRequirementMap } from './context';

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </Card>
  );
}

export function OverviewTab() {
  const { id, kit, detail } = useBuilder();
  const requirements = useRequirementMap();
  const weakSpots = useWeakSpots(id);
  const must = kit.role.requirements.filter((r) => r.priority === 'must').length;
  const uncovered = kit.coverage.uncovered_requirement_ids;
  const minutes = kit.schedule.days.reduce((sum, day) => sum + day.minutes, 0);

  return (
    <div className="space-y-6">
      {uncovered.length > 0 ? (
        <Alert
          tone="amber"
          title={`${uncovered.length} must-have requirement(s) have no question yet`}
        >
          <ul className="list-disc pl-5">
            {uncovered.map((rid) => (
              <li key={rid}>
                <span className="font-mono text-xs">{rid}</span> {requirements.get(rid)?.text}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Add a question for them on the Questions tab, or regenerate a category.
          </p>
        </Alert>
      ) : (
        <Alert tone="green" title="Every must-have requirement is covered by at least one question">
          Coverage was checked by code in {kit.coverage.passes} pass
          {kit.coverage.passes === 1 ? '' : 'es'}.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Requirements"
          value={kit.role.requirements.length}
          sub={`${must} must-have · ${kit.role.requirements.length - must} nice`}
        />
        <Stat
          label="Questions"
          value={kit.questions.length}
          sub={QUESTION_CATEGORIES.map(
            (c) =>
              `${kit.questions.filter((q) => q.category === c).length} ${CATEGORY_LABELS[c].toLowerCase()}`,
          ).join(' · ')}
        />
        <Stat
          label="Flashcards"
          value={kit.flashcards.length}
          sub={weakSpots.data ? `${weakSpots.data.practiced_flashcards} practised` : undefined}
        />
        <Stat
          label="Schedule"
          value={`${kit.schedule.days_available} ${kit.schedule.days_available === 1 ? 'day' : 'days'}`}
          sub={`${Math.round(minutes / 60)} h planned`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-900">What the company does</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            {kit.company_brief.what_they_do}
          </p>
          <h3 className="mt-4 text-sm font-semibold text-slate-900">Role</h3>
          <p className="mt-1 text-sm text-slate-700">
            {kit.role.title} · {kit.role.seniority} · {kit.source.location}
          </p>
        </Card>
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Info className="size-4 text-slate-400" aria-hidden /> Research notes
          </h3>
          {detail.notes.length === 0 && detail.warnings.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No gaps were found during research.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              {detail.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
                  <span>{note}</span>
                </li>
              ))}
              {detail.warnings
                .filter((w) => w.code !== 'COVERAGE_INCOMPLETE')
                .map((warning) => (
                  <li key={warning.message} className="flex gap-2">
                    <TriangleAlert
                      className="mt-0.5 size-3.5 shrink-0 text-amber-500"
                      aria-hidden
                    />
                    <span>{warning.message}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
