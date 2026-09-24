'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '@/components/ui';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

/**
 * Accessible tab list (WAI-ARIA tabs pattern): arrow keys, Home and End move between tabs.
 * Scrolls horizontally on narrow screens.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
  size = 'md',
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  idPrefix: string;
  size?: 'sm' | 'md';
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = items.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % items.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    onChange(items[target]!.id);
    refs.current[target]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx(
        '-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0',
        size === 'md' ? 'border-b border-slate-200' : '',
      )}
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            role="tab"
            type="button"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              'shrink-0 whitespace-nowrap text-sm font-medium transition-colors',
              size === 'md'
                ? cx(
                    '-mb-px border-b-2 px-3 py-2.5',
                    selected
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
                  )
                : cx(
                    'rounded-md px-3 py-1.5',
                    selected ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                  ),
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  id,
  children,
}: {
  idPrefix: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
