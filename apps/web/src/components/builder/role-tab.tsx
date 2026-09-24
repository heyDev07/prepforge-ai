'use client';

import { CheckCircle2, CircleAlert } from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { KIND_LABELS, KIND_TONES } from '@/lib/labels';
import { useBuilder } from './context';

export function RoleTab() {
  const { kit } = useBuilder();
  const { role } = kit;
  const questionCount = (rid: string) =>
    kit.questions.filter((q) => q.requirement_ids.includes(rid)).length;
  const cardCount = (rid: string) =>
    kit.flashcards.filter((f) => f.requirement_ids.includes(rid)).length;

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">{role.title}</h2>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          <div>
            <dt className="inline text-slate-500">Seniority: </dt>
            <dd className="inline">{role.seniority}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Location: </dt>
            <dd className="inline">{kit.source.location}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Job description: </dt>
            <dd className="inline">{kit.source.jd_chars.toLocaleString()} characters</dd>
          </div>
        </dl>
        {role.responsibilities.length > 0 ? (
          <>
            <h3 className="mt-5 text-sm font-semibold text-slate-900">Responsibilities</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {role.responsibilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Requirements</h2>
          <p className="text-sm text-slate-500">
            Extracted from the job description only. Each one was checked against the text, and none
            were invented.
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {role.requirements.map((requirement) => {
            const questions = questionCount(requirement.id);
            const covered = questions > 0;
            return (
              <li
                key={requirement.id}
                className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center"
              >
                <span className="w-8 shrink-0 font-mono text-xs text-slate-400">
                  {requirement.id}
                </span>
                <p className="flex-1 text-sm text-slate-800">{requirement.text}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONES[requirement.kind]}>{KIND_LABELS[requirement.kind]}</Badge>
                  <Badge tone={requirement.priority === 'must' ? 'brand' : 'neutral'}>
                    {requirement.priority === 'must' ? 'Must-have' : 'Nice-to-have'}
                  </Badge>
                  <span
                    className="inline-flex items-center gap-1 text-xs text-slate-500"
                    title={`${questions} question(s), ${cardCount(requirement.id)} flashcard(s)`}
                  >
                    {covered ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                    ) : (
                      <CircleAlert
                        className={
                          requirement.priority === 'must'
                            ? 'size-3.5 text-amber-500'
                            : 'size-3.5 text-slate-300'
                        }
                        aria-hidden
                      />
                    )}
                    {questions} Q · {cardCount(requirement.id)} cards
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
