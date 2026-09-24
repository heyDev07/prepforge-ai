'use client';

import { Check } from 'lucide-react';
import { cx } from '@/components/ui';
import { useBuilder } from './context';

/** Toggle buttons for linking an item to requirements (at least one must stay selected). */
export function RequirementPicker({
  value,
  onChange,
  labelId,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  labelId: string;
}) {
  const { kit } = useBuilder();
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto"
    >
      {kit.role.requirements.map((requirement) => {
        const selected = value.includes(requirement.id);
        return (
          <button
            key={requirement.id}
            type="button"
            aria-pressed={selected}
            onClick={() => toggle(requirement.id)}
            title={requirement.text}
            className={cx(
              'inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-left text-xs ring-1 ring-inset',
              selected
                ? 'bg-brand-50 text-brand-800 ring-brand-300'
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
            )}
          >
            {selected ? <Check className="size-3 shrink-0" aria-hidden /> : null}
            <span className="font-mono">{requirement.id}</span>
            <span className="truncate">{requirement.text}</span>
          </button>
        );
      })}
    </div>
  );
}
