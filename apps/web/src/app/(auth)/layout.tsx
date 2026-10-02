import { CheckCircle2, CircleDot, Circle } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand';

const STAGES: [string, 'done' | 'active' | 'next'][] = [
  ['Extracting requirements from the job description', 'done'],
  ['Researching the company website', 'done'],
  ['Generating questions by category', 'active'],
  ['Checking requirement coverage', 'next'],
  ['Building the day-by-day schedule', 'next'],
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative isolate hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col">
        <div className="bg-forge-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_30%_20%,black_25%,transparent_75%)]" />
        <div className="absolute -top-32 -left-24 -z-10 h-96 w-[560px] rounded-full bg-brand-500/25 blur-[110px]" />

        <Link href="/" aria-label="PrepForge home" className="w-fit">
          <Logo tone="light" />
        </Link>

        <div className="my-auto max-w-md">
          <h2 className="font-display text-4xl leading-tight font-bold tracking-tight">
            Prepare for the interview{' '}
            <span className="text-ember-gradient">you actually have.</span>
          </h2>
          <p className="mt-4 text-slate-300">
            Not generic questions. A kit built from this job post and this company, checked
            requirement by requirement.
          </p>

          <ol className="mt-10 space-y-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
            {STAGES.map(([label, state]) => (
              <li key={label} className="flex items-center gap-3 text-sm">
                {state === 'done' ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-400" aria-hidden />
                ) : state === 'active' ? (
                  <CircleDot className="size-4 shrink-0 animate-pulse text-brand-400" aria-hidden />
                ) : (
                  <Circle className="size-4 shrink-0 text-slate-600" aria-hidden />
                )}
                <span className={state === 'next' ? 'text-slate-500' : 'text-slate-200'}>
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-slate-500">
          Research uses only the company&apos;s public website and public interview discussion.
        </p>
      </aside>

      <div className="flex flex-col items-center justify-center px-4 py-12 sm:px-8">
        <Link href="/" aria-label="PrepForge home" className="mb-8 lg:hidden">
          <Logo />
        </Link>
        <div className="w-full max-w-sm animate-rise">{children}</div>
      </div>
    </main>
  );
}
