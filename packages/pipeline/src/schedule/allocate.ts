/**
 * Deterministic day-by-day schedule. The LLM never decides the schedule.
 *
 * 1. Score and sort questions (score.ts): must-have, difficult, technical and weak material first.
 * 2. Protect coverage: if the questions do not fit (MAX_DAY_MINUTES per learning day), first
 *    take a greedy set cover of every covered must-have requirement, then fill by priority.
 * 3. With 3+ days, ~20% of days (at least 1) are review days; the rest are learning days,
 *    as many as needed for ~TARGET_DAY_MINUTES per day.
 * 4. Learning days take contiguous chunks of the priority order, so the most important
 *    material comes first.
 * 5. Review days cycle through the priority order; the final day is a mock interview with the
 *    top question of each category.
 * 6. minutes = Σ question minutes (+ flashcard review), always an integer.
 *
 * Output always has exactly `daysAvailable` days, numbered 1..N.
 */
import {
  QUESTION_CATEGORIES,
  type Question,
  type Requirement,
  type Schedule,
  type ScheduleDay,
} from '@prepforge/shared';
import { EMPTY_DAY_FOCUS, MOCK_INTERVIEW_FOCUS, learningFocus, reviewFocus } from './focus';
import { byPriority, scoreQuestions, type ScoredQuestion } from './score';

export const TARGET_DAY_MINUTES = 60;
export const MAX_DAY_MINUTES = 240;
export const FLASHCARD_REVIEW_MINUTES = 10;
export const EMPTY_DAY_MINUTES = 30;

export interface ScheduleInput {
  daysAvailable: number;
  requirements: readonly Requirement[];
  questions: readonly Question[];
  flashcardCount?: number;
  weakRequirementIds?: ReadonlySet<string>;
}

/** Greedy set cover: the fewest high-priority questions that touch every covered must-have. */
function coverMustHaves(
  ordered: ScoredQuestion[],
  mustIds: ReadonlySet<string>,
): Set<ScoredQuestion> {
  const remaining = new Set(
    ordered.flatMap((s) => s.question.requirement_ids).filter((id) => mustIds.has(id)),
  );
  const chosen = new Set<ScoredQuestion>();
  while (remaining.size > 0) {
    let best: ScoredQuestion | null = null;
    let bestGain = 0;
    for (const candidate of ordered) {
      if (chosen.has(candidate)) continue;
      const gain = new Set(candidate.question.requirement_ids.filter((id) => remaining.has(id)))
        .size;
      if (gain > bestGain) {
        best = candidate;
        bestGain = gain;
      }
    }
    if (!best) break;
    chosen.add(best);
    for (const id of best.question.requirement_ids) remaining.delete(id);
  }
  return chosen;
}

/**
 * Splits an ordered list into `parts` contiguous, non-empty chunks with balanced minutes.
 * Requires parts <= items.length.
 */
function chunkByMinutes(items: ScoredQuestion[], parts: number): ScoredQuestion[][] {
  const chunks: ScoredQuestion[][] = [];
  let cursor = 0;
  for (let part = 0; part < parts; part++) {
    const daysLeft = parts - part;
    if (daysLeft === 1) {
      chunks.push(items.slice(cursor));
      break;
    }
    const target = items.slice(cursor).reduce((sum, s) => sum + s.minutes, 0) / daysLeft;
    const chunk: ScoredQuestion[] = [];
    let minutes = 0;
    // leave at least one question for each remaining day
    while (cursor < items.length - (daysLeft - 1)) {
      const next = items[cursor]!;
      if (chunk.length > 0 && minutes + next.minutes / 2 > target) break;
      chunk.push(next);
      minutes += next.minutes;
      cursor++;
    }
    chunks.push(chunk);
  }
  return chunks;
}

export function allocateSchedule(input: ScheduleInput): Schedule {
  const n = input.daysAvailable;
  const requirementsById = new Map(input.requirements.map((r) => [r.id, r]));
  const mustIds = new Set(input.requirements.filter((r) => r.priority === 'must').map((r) => r.id));
  const extraMinutes = (input.flashcardCount ?? 0) > 0 ? FLASHCARD_REVIEW_MINUTES : 0;

  const ordered = scoreQuestions(
    input.requirements,
    input.questions,
    input.weakRequirementIds,
  ).sort(byPriority);

  if (ordered.length === 0) {
    return {
      days_available: n,
      days: Array.from({ length: n }, (_, i) => ({
        day: i + 1,
        focus: EMPTY_DAY_FOCUS,
        question_ids: [],
        minutes: EMPTY_DAY_MINUTES,
      })),
    };
  }

  const reviewDays = n >= 3 ? Math.max(1, Math.floor(n * 0.2)) : 0;
  const learnCapacityDays = n - reviewDays;

  // 1–2. selection with coverage protection
  const capacity = learnCapacityDays * MAX_DAY_MINUTES;
  const required = coverMustHaves(ordered, mustIds);
  let used = [...required].reduce((sum, s) => sum + s.minutes, 0);
  const selected = new Set(required);
  for (const scored of ordered) {
    if (selected.has(scored)) continue;
    if (used + scored.minutes > capacity) continue;
    selected.add(scored);
    used += scored.minutes;
  }
  const learnPool = ordered.filter((s) => selected.has(s));

  // 3. number of learning days
  const totalMinutes = learnPool.reduce((sum, s) => sum + s.minutes, 0);
  const learnDays = Math.min(
    learnCapacityDays,
    learnPool.length,
    Math.max(1, Math.ceil(totalMinutes / TARGET_DAY_MINUTES)),
  );

  // 4. learning days
  const days: ScheduleDay[] = chunkByMinutes(learnPool, learnDays).map((chunk, i) => ({
    day: i + 1,
    focus: learningFocus(
      chunk.map((s) => s.question),
      requirementsById,
    ),
    question_ids: chunk.map((s) => s.question.id),
    minutes: chunk.reduce((sum, s) => sum + s.minutes, 0) + extraMinutes,
  }));

  // 5. review days (round-robin over the full priority order) and a final mock interview
  let pointer = 0;
  for (let day = learnDays + 1; day <= n; day++) {
    const isMock = day === n;
    let picked: ScoredQuestion[];
    if (isMock) {
      picked = QUESTION_CATEGORIES.map((category) =>
        ordered.find((s) => s.question.category === category),
      ).filter((s): s is ScoredQuestion => s !== undefined);
    } else {
      picked = [];
      let minutes = 0;
      const limit = Math.min(ordered.length, 8);
      while (picked.length < limit && (picked.length === 0 || minutes < TARGET_DAY_MINUTES)) {
        const next = ordered[pointer % ordered.length]!;
        pointer++;
        picked.push(next);
        minutes += next.minutes;
      }
    }
    days.push({
      day,
      focus: isMock
        ? MOCK_INTERVIEW_FOCUS
        : reviewFocus(
            picked.map((s) => s.question),
            requirementsById,
          ),
      question_ids: picked.map((s) => s.question.id),
      minutes: picked.reduce((sum, s) => sum + s.minutes, 0) + extraMinutes,
    });
  }

  return { days_available: n, days };
}
