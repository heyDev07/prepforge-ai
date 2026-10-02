'use client';

import type { InternalKit, KitDetailDto } from '@prepforge/shared';
import { CalendarDays, Download, FileQuestion, Globe, Layers, Loader2, Play } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CompanyAvatar } from '@/components/company-avatar';
import { Alert, Badge } from '@/components/ui';
import { JobError } from '@/components/generation-progress';
import { api } from '@/lib/api';
import { CATEGORY_LABELS, hostname, stageLabel, STATUS_LABELS, STATUS_TONES } from '@/lib/labels';
import { useGenerationStatus } from '@/lib/queries';
import { CompanyTab } from './company-tab';
import { BuilderContext } from './context';
import { FlashcardsTab } from './flashcards-tab';
import { OverviewTab } from './overview-tab';
import { PracticeTab } from './practice-tab';
import { QuestionsTab } from './questions-tab';
import { RoleTab } from './role-tab';
import { ScheduleTab } from './schedule-tab';
import { TabPanel, Tabs } from './tabs';

const TABS = [
  { id: 'overview', label: 'Overview', Panel: OverviewTab },
  { id: 'company', label: 'Company', Panel: CompanyTab },
  { id: 'role', label: 'Role', Panel: RoleTab },
  { id: 'questions', label: 'Questions', Panel: QuestionsTab },
  { id: 'flashcards', label: 'Flashcards', Panel: FlashcardsTab },
  { id: 'schedule', label: 'Schedule', Panel: ScheduleTab },
  { id: 'practice', label: 'Practice', Panel: PracticeTab },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function KitBuilder({ detail, kit }: { detail: KitDetailDto; kit: InternalKit }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : 'overview';

  const latest = detail.latest_job;
  const status = useGenerationStatus(
    detail.id,
    latest?.status === 'queued' || latest?.status === 'running',
  );
  const job = status.data?.job ?? latest;
  const busy = job?.status === 'queued' || job?.status === 'running';
  const lastRegenFailed = job && job.type !== 'generate' && job.status === 'failed';

  function selectTab(next: TabId) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const Panel = TABS.find((t) => t.id === tab)!.Panel;

  return (
    <BuilderContext.Provider value={{ id: detail.id, detail, kit, busy }}>
      <div className="space-y-6">
        <header className="relative overflow-hidden rounded-2xl bg-ink-950 p-5 text-white shadow-lift sm:p-7">
          <div
            aria-hidden
            className="bg-forge-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black_20%,transparent_70%)]"
          />
          <div
            aria-hidden
            className="absolute -top-24 -right-20 h-64 w-96 rounded-full bg-brand-500/25 blur-[90px]"
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <CompanyAvatar name={kit.source.company} size="lg" className="ring-white/10" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate font-display text-2xl font-bold tracking-tight sm:text-3xl">
                    {kit.source.company}
                  </h1>
                  <Badge tone={STATUS_TONES[detail.status]}>{STATUS_LABELS[detail.status]}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-300 sm:text-base">{kit.role.title}</p>
                <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">Website</dt>
                    <Globe className="size-4" aria-hidden />
                    <dd>
                      <a
                        href={kit.source.company_url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="hover:text-white hover:underline"
                      >
                        {hostname(kit.source.company_url)}
                      </a>
                    </dd>
                  </div>
                  {[
                    {
                      label: 'Days',
                      icon: CalendarDays,
                      value: `${kit.schedule.days_available} ${kit.schedule.days_available === 1 ? 'day' : 'days'}`,
                    },
                    {
                      label: 'Questions',
                      icon: FileQuestion,
                      value: `${kit.questions.length} questions`,
                    },
                    { label: 'Flashcards', icon: Layers, value: `${kit.flashcards.length} cards` },
                  ].map(({ label, icon: Icon, value }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <dt className="sr-only">{label}</dt>
                      <Icon className="size-4" aria-hidden />
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <a
                href={api.exportUrl(detail.id)}
                download
                className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white ring-1 ring-white/20 transition hover:bg-white/10"
              >
                <Download className="size-4" aria-hidden /> Export JSON
              </a>
              <Link
                href={`/kits/${detail.id}/practice`}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-4 text-sm font-semibold text-white shadow-ember transition hover:from-brand-600 hover:to-brand-700"
              >
                <Play className="size-4" aria-hidden /> Practise
              </Link>
            </div>
          </div>
        </header>

        {busy && job ? (
          <Alert tone="blue">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {job.type === 'regenerate_company'
                ? 'Regenerating the company brief'
                : `Regenerating ${job.category ? CATEGORY_LABELS[job.category].toLowerCase() : ''} questions`}
              {job.current_stage ? ` · ${stageLabel(job.current_stage, 1)}` : '…'}
              <span className="text-sky-800/70">Editing is paused until it finishes.</span>
            </span>
          </Alert>
        ) : lastRegenFailed ? (
          <JobError job={job} />
        ) : null}

        <Tabs
          idPrefix="kit"
          label="Kit sections"
          value={tab}
          onChange={selectTab}
          items={TABS.map(({ id, label }) => ({ id, label }))}
        />
        <TabPanel idPrefix="kit" id={tab}>
          <Panel />
        </TabPanel>
      </div>
    </BuilderContext.Provider>
  );
}
