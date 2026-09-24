'use client';

import { MAX_DAYS, MIN_DAYS } from '@prepforge/shared';
import { Clock, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { CATEGORY_LABELS } from '@/lib/labels';
import { useKitMutation } from '@/lib/queries';
import { useBuilder } from './context';

export function ScheduleTab() {
  const { id, kit, detail, busy } = useBuilder();
  const [days, setDays] = useState(String(kit.schedule.days_available));
  const questions = new Map(kit.questions.map((q) => [q.id, q]));

  const changeDays = useKitMutation(
    id,
    (value: number) => api.updateKit(id, { days_available: value, revision: detail.revision }),
    { success: (data) => `Schedule rebuilt for ${data.kit.kit?.schedule.days_available} day(s).` },
  );
  const rebuild = useKitMutation(id, () => api.regenerateSchedule(id, detail.revision), {
    success: 'Schedule rebuilt. Weak areas from practice are prioritised.',
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(days);
    if (Number.isInteger(value) && value >= MIN_DAYS && value <= MAX_DAYS) changeDays.mutate(value);
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
        <form onSubmit={submit} className="flex items-end gap-2">
          <Field label="Days until the interview">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={MIN_DAYS}
                max={MAX_DAYS}
                className="w-28"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            )}
          </Field>
          <Button
            type="submit"
            disabled={busy || Number(days) === kit.schedule.days_available}
            loading={changeDays.isPending}
          >
            Update
          </Button>
        </form>
        <div className="flex flex-col gap-1 sm:items-end">
          <Button
            disabled={busy}
            loading={rebuild.isPending}
            icon={<RefreshCw className="size-4" aria-hidden />}
            onClick={() => rebuild.mutate(undefined)}
          >
            Rebuild schedule
          </Button>
          <p className="text-xs text-slate-500">
            Built by code: must-have, harder and weaker material comes first.
          </p>
        </div>
      </Card>

      <ol className="grid gap-3 md:grid-cols-2">
        {kit.schedule.days.map((day) => (
          <li key={day.day}>
            <Card className="h-full p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
                    Day {day.day}
                  </p>
                  <h3 className="mt-0.5 text-sm font-medium text-slate-900">{day.focus}</h3>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500">
                  <Clock className="size-3.5" aria-hidden /> {day.minutes} min
                </span>
              </div>
              {day.question_ids.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {day.question_ids.map((qid) => {
                    const question = questions.get(qid);
                    if (!question) return null;
                    return (
                      <li key={qid} className="flex gap-2 text-sm text-slate-700">
                        <Badge className="h-fit">{CATEGORY_LABELS[question.category]}</Badge>
                        <span className="line-clamp-2">{question.prompt}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  Review the company brief and your notes.
                </p>
              )}
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
