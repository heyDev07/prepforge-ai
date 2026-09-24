import type {
  GenerationStage,
  KitStatus,
  QuestionCategory,
  RequirementKind,
} from '@prepforge/shared';

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

export const KIND_LABELS: Record<RequirementKind, string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  domain: 'Domain',
};

export const KIND_TONES = { technical: 'blue', behavioural: 'violet', domain: 'amber' } as const;

export const DIFFICULTY_LABELS: Record<number, string> = { 1: 'Warm-up', 2: 'Standard', 3: 'Hard' };

export const STATUS_LABELS: Record<KitStatus, string> = {
  draft: 'Draft',
  generating: 'Generating',
  ready: 'Ready',
  ready_with_gaps: 'Ready · gaps',
  failed: 'Failed',
};

export const STATUS_TONES = {
  draft: 'neutral',
  generating: 'brand',
  ready: 'green',
  ready_with_gaps: 'amber',
  failed: 'red',
} as const;

/** "validating" appears twice in the pipeline, so labels are keyed by occurrence. */
export function stageLabel(stage: GenerationStage, occurrence = 0): string {
  const labels: Record<GenerationStage, string> = {
    validating: occurrence === 0 ? 'Validating input' : 'Validating the kit',
    extracting_requirements: 'Extracting requirements from the job description',
    researching_company: 'Researching the company website',
    researching_interviews: 'Searching public interview discussions',
    generating_company_brief: 'Writing the company brief',
    generating_questions: 'Generating questions by category',
    checking_coverage: 'Checking requirement coverage',
    generating_missing_questions: 'Filling coverage gaps',
    generating_flashcards: 'Generating flashcards',
    building_schedule: 'Building the day-by-day schedule',
    persisting: 'Saving the kit',
    completed: 'Done',
  };
  return labels[stage];
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
}

export function hostname(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
