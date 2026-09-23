import type {
  InternalFlashcard,
  InternalKit,
  InternalQuestion,
  QuestionCategory,
  Requirement,
} from '@prepforge/shared';
import { checkCoverage } from '../../src/coverage/check-coverage';
import { allocateSchedule } from '../../src/schedule/allocate';

export function req(
  n: number,
  kind: Requirement['kind'] = 'technical',
  priority: Requirement['priority'] = 'must',
): Requirement {
  return { id: `r${n}`, text: `Requirement ${n}`, kind, priority };
}

export function question(
  n: number,
  requirementIds: string[],
  overrides: Partial<InternalQuestion> = {},
): InternalQuestion {
  return {
    id: `q${n}`,
    requirement_ids: requirementIds,
    category: 'technical' as QuestionCategory,
    prompt: `Question ${n}?`,
    answer_outline: `Outline ${n}`,
    difficulty: 2,
    state: 'generated',
    origin: 'generated',
    ...overrides,
  };
}

export function card(n: number, requirementIds: string[]): InternalFlashcard {
  return {
    id: `f${n}`,
    front: `Front ${n}`,
    back: `Back ${n}`,
    requirement_ids: requirementIds,
    state: 'generated',
    origin: 'generated',
  };
}

/** A consistent internal kit (coverage and schedule derived with the real algorithms). */
export function buildKit(options: {
  requirements: Requirement[];
  questions: InternalQuestion[];
  flashcards?: InternalFlashcard[];
  days?: number;
  passes?: number;
}): InternalKit {
  const days = options.days ?? 3;
  const flashcards = options.flashcards ?? [];
  const maxId = (ids: string[]) => Math.max(0, ...ids.map((id) => Number(id.slice(1))));
  return {
    source: {
      company: 'Acme Robotics',
      company_url: 'https://acme.example',
      role: 'Backend Engineer',
      location: 'Berlin',
      jd_chars: 900,
      researched_at: '2026-09-23T10:00:00.000Z',
      pages_used: ['https://acme.example/'],
    },
    company_brief: {
      summary: 'Acme builds warehouse robots.',
      what_they_do: 'Autonomous mobile robots.',
      sources: ['https://acme.example/'],
      state: 'generated',
    },
    role: {
      title: 'Backend Engineer',
      seniority: 'Senior',
      responsibilities: ['Build services'],
      requirements: options.requirements,
    },
    questions: options.questions,
    flashcards,
    schedule: allocateSchedule({
      daysAvailable: days,
      requirements: options.requirements,
      questions: options.questions,
      flashcardCount: flashcards.length,
    }),
    coverage: checkCoverage(options.requirements, options.questions, options.passes ?? 1),
    counters: {
      question: maxId(options.questions.map((q) => q.id)),
      flashcard: maxId(flashcards.map((f) => f.id)),
    },
  };
}
