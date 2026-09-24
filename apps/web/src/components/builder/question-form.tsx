'use client';

import { QUESTION_CATEGORIES, type QuestionCategory } from '@prepforge/shared';
import { useId, useState, type FormEvent } from 'react';
import { Button, Field, Select, Textarea } from '@/components/ui';
import type { QuestionInput } from '@/lib/api';
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from '@/lib/labels';
import { RequirementPicker } from './requirement-picker';

/** Edits a question locally; nothing is sent until Save. */
export function QuestionForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: QuestionInput;
  submitLabel: string;
  pending: boolean;
  onSubmit: (value: QuestionInput) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<QuestionInput>(initial);
  const requirementsLabel = useId();
  const valid =
    value.prompt.trim().length > 0 &&
    value.answer_outline.trim().length > 0 &&
    value.requirement_ids.length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      onSubmit({
        ...value,
        prompt: value.prompt.trim(),
        answer_outline: value.answer_outline.trim(),
      });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Question">
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            autoFocus
            value={value.prompt}
            onChange={(e) => setValue({ ...value, prompt: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Answer outline"
        hint="What a strong answer covers. One point per line works well."
      >
        {(props) => (
          <Textarea
            {...props}
            rows={5}
            value={value.answer_outline}
            onChange={(e) => setValue({ ...value, answer_outline: e.target.value })}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category">
          {(props) => (
            <Select
              {...props}
              value={value.category}
              onChange={(e) => setValue({ ...value, category: e.target.value as QuestionCategory })}
            >
              {QUESTION_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Difficulty">
          {(props) => (
            <Select
              {...props}
              value={value.difficulty}
              onChange={(e) =>
                setValue({ ...value, difficulty: Number(e.target.value) as 1 | 2 | 3 })
              }
            >
              {[1, 2, 3].map((d) => (
                <option key={d} value={d}>
                  {d} · {DIFFICULTY_LABELS[d]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="space-y-1.5">
        <p id={requirementsLabel} className="text-sm font-medium text-slate-800">
          Requirements tested
        </p>
        <RequirementPicker
          labelId={requirementsLabel}
          value={value.requirement_ids}
          onChange={(ids) => setValue({ ...value, requirement_ids: ids })}
        />
        {value.requirement_ids.length === 0 ? (
          <p className="text-sm text-red-600">Select at least one requirement.</p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending} disabled={!valid}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
