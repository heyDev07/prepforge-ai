import { cx } from '@/lib/cx';

/** The PrepForge mark: a spark rising off an anvil, on an ember tile. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'relative grid shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 text-white shadow-ember ring-1 ring-white/20',
        className ?? 'size-8',
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none">
        <path
          d="M12 2.5c.9 2.1 3.4 3.4 3.4 6.1a3.4 3.4 0 0 1-6.8 0c0-1.2.5-2 1.2-2.8.2 1 .8 1.6 1.5 1.6-.2-1.9-.1-3.4.7-4.9Z"
          fill="currentColor"
        />
        <path
          d="M4 14h13.5a2.5 2.5 0 0 0 2.5-2.5V11h-2.2M6 14c0 1.7 1.3 3 3 3h6c1.7 0 3-1.3 3-3M9.5 17v3.5h5V17"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Logo({
  className,
  tone = 'dark',
  size = 'md',
}: {
  className?: string;
  tone?: 'dark' | 'light';
  size?: 'md' | 'lg';
}) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={size === 'lg' ? 'size-10' : 'size-8'} />
      <span
        className={cx(
          'font-display font-bold tracking-tight',
          size === 'lg' ? 'text-2xl' : 'text-lg',
          tone === 'light' ? 'text-white' : 'text-slate-900',
        )}
      >
        Prep<span className="text-brand-500">Forge</span>
      </span>
    </span>
  );
}
