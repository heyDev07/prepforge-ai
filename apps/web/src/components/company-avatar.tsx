import { cx } from '@/lib/cx';

const PALETTES = [
  'from-ink-800 to-ink-950 text-brand-300',
  'from-brand-500 to-brand-700 text-white',
  'from-sky-600 to-indigo-800 text-white',
  'from-emerald-600 to-teal-800 text-white',
  'from-violet-600 to-fuchsia-800 text-white',
  'from-amber-500 to-orange-700 text-white',
];

/** A stable palette per company, so a kit keeps its colour across visits. */
function paletteFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTES[hash % PALETTES.length]!;
}

export function CompanyAvatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={cx(
        'grid shrink-0 place-items-center bg-gradient-to-br font-display font-bold shadow-sm ring-1 ring-black/5',
        size === 'lg' ? 'size-14 rounded-2xl text-2xl' : 'size-11 rounded-xl text-lg',
        paletteFor(name),
        className,
      )}
    >
      {initial}
    </span>
  );
}
