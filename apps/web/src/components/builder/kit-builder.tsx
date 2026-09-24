'use client';

import type { InternalKit, KitDetailDto } from '@prepforge/shared';
import { Download, Loader2, Play } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
      <div className="space-y-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">
                {kit.source.company}
              </h1>
              <Badge tone={STATUS_TONES[detail.status]}>{STATUS_LABELS[detail.status]}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {kit.role.title} ·{' '}
              <a
                href={kit.source.company_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="hover:underline"
              >
                {hostname(kit.source.company_url)}
              </a>{' '}
              · {kit.schedule.days_available} {kit.schedule.days_available === 1 ? 'day' : 'days'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <a
              href={api.exportUrl(detail.id)}
              download
              className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-4 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              <Download className="size-4" aria-hidden /> Export JSON
            </a>
            <Link
              href={`/kits/${detail.id}/practice`}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              <Play className="size-4" aria-hidden /> Practise
            </Link>
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
