import {
  ArrowRight,
  BookOpenCheck,
  CalendarRange,
  CheckCircle2,
  Download,
  FileSearch,
  Globe,
  Layers,
  ListChecks,
  PencilLine,
  Quote,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand';
import { cx } from '@/lib/cx';

export const metadata: Metadata = {
  title: { absolute: 'PrepForge — interview prep, researched and verified' },
};

/** Public landing page. Signed-in visitors are sent to the dashboard by the proxy. */
export default function Home() {
  return (
    <div className="bg-white">
      <Hero />
      <HowItWorks />
      <Principle />
      <Features />
      <ClosingCta />
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-6">
          <Logo />
          <p>
            Built from your job description, the company&apos;s own website and public discussion.
          </p>
        </div>
      </footer>
    </div>
  );
}

const primaryCta =
  'inline-flex h-11 items-center gap-2 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-5 text-sm font-semibold text-white shadow-ember transition hover:from-brand-600 hover:to-brand-700';

function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-ink-950 text-white">
      <div className="bg-forge-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
      <div className="absolute -top-40 left-1/2 -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-brand-500/25 blur-[120px]" />
      <div className="absolute right-[-10%] bottom-[-30%] -z-10 h-[420px] w-[520px] rounded-full bg-brand-700/25 blur-[120px]" />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo tone="light" />
        <nav className="flex items-center gap-1 text-sm sm:gap-2" aria-label="Main">
          <a
            href="#how"
            className="hidden rounded-md px-3 py-2 text-slate-300 hover:text-white sm:inline"
          >
            How it works
          </a>
          <Link href="/login" className="rounded-md px-3 py-2 text-slate-300 hover:text-white">
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-white px-3.5 py-2 font-semibold text-ink-950 hover:bg-brand-50"
          >
            Get started
          </Link>
        </nav>
      </header>

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-16 lg:pb-28">
        <div className="animate-rise">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-brand-200 ring-1 ring-white/10">
            <Sparkles className="size-3.5" aria-hidden /> Interview prep, researched and verified
          </p>
          <h1 className="mt-5 font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Walk into the interview <span className="text-ember-gradient">already prepared.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Paste a job description and the company&apos;s website. PrepForge researches the
            company, pulls out every requirement, and builds the questions, flashcards and
            day-by-day plan you need, with every requirement traced back to the job post.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/register" className={primaryCta}>
              Build your first kit <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/login"
              className="inline-flex h-11 items-center rounded-lg px-5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/5"
            >
              I have an account
            </Link>
          </div>
          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-6">
            {[
              ['~1 min', 'to a full kit'],
              ['4', 'question categories'],
              ['100%', 'must-haves checked'],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="sr-only">{label}</dt>
                <dd className="font-display text-2xl font-bold text-white">{value}</dd>
                <dd className="text-xs text-slate-400">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <KitPreview />
      </div>
    </section>
  );
}

/** A static example of a finished kit, so visitors see the product before signing up. */
function KitPreview() {
  const requirements: [string, 'must' | 'nice'][] = [
    ['TypeScript & Node.js', 'must'],
    ['PostgreSQL tuning', 'must'],
    ['Event-driven systems', 'must'],
    ['Mentoring engineers', 'must'],
    ['Go', 'nice'],
  ];
  const days = [
    ['Day 1', 'Event-driven systems', 85],
    ['Day 2', 'PostgreSQL & schemas', 70],
    ['Day 3', 'System design round', 95],
    ['Day 4', 'Review weak spots', 50],
    ['Day 5', 'Mock interview', 100],
  ] as const;

  return (
    <div className="relative animate-rise [animation-delay:120ms]" aria-label="Example prep kit">
      <div className="rounded-2xl bg-white p-5 text-slate-900 shadow-2xl ring-1 shadow-black/40 ring-white/10 sm:p-6 sm:pb-12">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-ink-900 font-display text-lg font-bold text-white">
              A
            </span>
            <div>
              <p className="font-display text-base font-semibold">Acme Robotics</p>
              <p className="text-xs text-slate-500">Senior Backend Engineer · 5 days</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            Ready
          </span>
        </div>

        <p className="mt-5 font-mono text-[10px] tracking-widest text-slate-400 uppercase">
          Requirements from the JD
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {requirements.map(([text, priority]) => (
            <span
              key={text}
              className={cx(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1',
                priority === 'must'
                  ? 'bg-slate-50 text-slate-800 ring-slate-200'
                  : 'bg-white text-slate-500 ring-slate-200',
              )}
            >
              {priority === 'must' ? (
                <CheckCircle2 className="size-3 text-emerald-600" aria-hidden />
              ) : null}
              {text}
              {priority === 'nice' ? <span className="text-slate-400">· nice</span> : null}
            </span>
          ))}
        </div>

        <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-ink-900 px-1.5 py-0.5 font-medium text-white">
              System design
            </span>
            <span className="text-slate-500">Hard · their published round</span>
          </div>
          <p className="mt-2 text-sm leading-snug font-medium">
            Design the service that assigns warehouse tasks to 500 robots in real time, and keeps
            working when a robot drops offline.
          </p>
        </div>

        <p className="mt-5 font-mono text-[10px] tracking-widest text-slate-400 uppercase">
          Your plan
        </p>
        <ul className="mt-2 space-y-1.5">
          {days.map(([day, focus, width]) => (
            <li key={day} className="grid grid-cols-[3.5rem_1fr] items-center gap-3 text-xs">
              <span className="font-medium text-slate-500">{day}</span>
              <span className="relative h-6 overflow-hidden rounded-md bg-slate-100">
                <span
                  className="absolute inset-y-0 left-0 rounded-md bg-gradient-to-r from-brand-200 to-brand-300"
                  style={{ width: `${width}%` }}
                />
                <span className="relative flex h-full items-center px-2 font-medium text-slate-800">
                  {focus}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="absolute -bottom-5 -left-3 hidden items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 text-white shadow-xl ring-1 ring-white/10 sm:flex">
        <ShieldCheck className="size-5 text-emerald-400" aria-hidden />
        <div className="text-xs">
          <p className="font-semibold">Coverage checked by code</p>
          <p className="text-slate-400">4 of 4 must-haves have questions</p>
        </div>
      </div>
      <div className="absolute -top-4 -right-3 hidden items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-xl ring-1 ring-slate-200 sm:flex">
        <Quote className="size-4 text-brand-500" aria-hidden />
        Every requirement quoted from the JD
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono text-xs font-medium tracking-widest text-brand-600 uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        {title}
      </h2>
      {children ? (
        <p className="mt-4 text-base leading-relaxed text-slate-600">{children}</p>
      ) : null}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: PencilLine,
      title: 'Paste the job post',
      body: 'Add the job description, the company’s website and how many days you have until the interview.',
    },
    {
      icon: Globe,
      title: 'We research the company',
      body: 'A polite crawler reads its about, careers and engineering pages, and we search public interview discussion.',
    },
    {
      icon: ListChecks,
      title: 'The kit is built and checked',
      body: 'Requirements must be quoted from the JD. Every must-have gets a question, or the gap is shown to you.',
    },
    {
      icon: Target,
      title: 'Practise to a plan',
      body: 'Follow the day-by-day schedule, rate your confidence on flashcards, and drill your weak spots.',
    },
  ];
  return (
    <section id="how" className="scroll-mt-8 border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHeading
          eyebrow="How it works"
          title="From job post to study plan in about a minute"
        >
          You can watch each stage run live, leave the page, and come back when it&apos;s done.
        </SectionHeading>
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ icon: Icon, title, body }, index) => (
            <li
              key={title}
              className="relative rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-lift"
            >
              <span className="font-mono text-xs text-slate-400">0{index + 1}</span>
              <span className="mt-3 grid size-11 place-items-center rounded-xl bg-white text-brand-600 shadow-sm ring-1 ring-slate-200">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-slate-900">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Principle() {
  const model = [
    'Reads the job description',
    'Summarises the company from its own pages',
    'Writes questions and answer outlines',
    'Writes flashcards',
  ];
  const code = [
    'Keeps a requirement only if its quote is in the JD',
    'Maps every claim in the brief to a source URL',
    'Checks every must-have is covered',
    'Builds a schedule of exactly your days',
  ];
  return (
    <section className="bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <SectionHeading
          eyebrow="Why you can trust it"
          title={
            <>
              The AI writes.
              <br />
              <span className="text-brand-600">Code checks.</span>
            </>
          }
        >
          A language model is great at reading and writing, and bad at guarantees. So it never
          decides what counts as a requirement, whether one is covered, or how your days are
          planned. Plain, tested code does.
        </SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <PrincipleCard
            title="The model"
            icon={<Sparkles className="size-4" aria-hidden />}
            items={model}
            tone="light"
          />
          <PrincipleCard
            title="The code"
            icon={<ShieldCheck className="size-4" aria-hidden />}
            items={code}
            tone="dark"
          />
        </div>
      </div>
    </section>
  );
}

function PrincipleCard({
  title,
  icon,
  items,
  tone,
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  tone: 'light' | 'dark';
}) {
  const dark = tone === 'dark';
  return (
    <div
      className={cx(
        'rounded-2xl p-6 ring-1',
        dark ? 'bg-ink-950 text-white ring-ink-800' : 'bg-white text-slate-900 ring-slate-200',
      )}
    >
      <p
        className={cx(
          'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold',
          dark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-brand-50 text-brand-700',
        )}
      >
        {icon} {title}
      </p>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-snug">
            <CheckCircle2
              className={cx('mt-0.5 size-4 shrink-0', dark ? 'text-emerald-400' : 'text-brand-500')}
              aria-hidden
            />
            <span className={dark ? 'text-slate-200' : 'text-slate-700'}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Features() {
  const features = [
    {
      icon: FileSearch,
      title: 'A brief with sources',
      body: 'What the company does and how it hires, with every source linked and research gaps stated plainly.',
    },
    {
      icon: BookOpenCheck,
      title: 'Four kinds of questions',
      body: 'Technical, behavioural, system design and company fit, shaped by the interview process they publish.',
    },
    {
      icon: Layers,
      title: 'Flashcards that adapt',
      body: 'Rate your confidence from 1 to 5. The weakest cards come back first, round after round.',
    },
    {
      icon: Target,
      title: 'Weak Spots',
      body: 'A readiness score and the requirements holding it down, fed straight back into your plan.',
    },
    {
      icon: CalendarRange,
      title: 'A plan for your days',
      body: 'From one day to sixty. Hard, must-have material first, review days built in, a mock interview at the end.',
    },
    {
      icon: Download,
      title: 'Yours to edit',
      body: 'Edit, pin, reorder or regenerate any section without losing your changes, then export the kit as JSON.',
    },
  ];
  return (
    <section className="border-y border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHeading
          eyebrow="What you get"
          title="Everything you need for one interview, in one place"
        />
        <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="bg-white px-4 py-20 sm:px-6">
      <div className="relative isolate mx-auto max-w-5xl overflow-hidden rounded-3xl bg-ink-950 px-6 py-14 text-center text-white sm:px-12">
        <div className="bg-forge-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
        <div className="absolute -bottom-32 left-1/2 -z-10 h-72 w-[600px] -translate-x-1/2 rounded-full bg-brand-500/30 blur-[100px]" />
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Your next interview has a plan.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-slate-300">
          Create an account, paste a job post, and have a researched prep kit in about a minute.
        </p>
        <Link href="/register" className={cx(primaryCta, 'mt-8')}>
          Build your first kit <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
