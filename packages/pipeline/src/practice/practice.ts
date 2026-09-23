/**
 * Practice mode and Weak Spots — deterministic application code.
 *
 *   card confidence   = exponentially weighted average of ratings (α = 0.5; recent counts more)
 *   card priority     = (5 − confidence) + 0.5 if it supports a must-have + staleness (≤ 1)
 *                       unseen cards count as confidence 2.5
 *   requirement conf. = mean confidence of its practised cards
 *   weak requirement  = uncovered must-have, must-have without a card, or confidence < 3
 *   readiness         = weighted mean of (confidence − 1) / 4 over requirements
 *                       (must-have weight 2, nice weight 1, unpractised = 0) × 100
 */
import {
  QUESTION_CATEGORIES,
  type CardStats,
  type CategoryStrength,
  type InternalFlashcard,
  type InternalKit,
  type PracticeAttemptRecord,
  type QuestionCategory,
  type RequirementStrength,
  type WeakReason,
  type WeakSpotsReport,
} from '@prepforge/shared';
import { findUncoveredRequirements } from '../coverage/check-coverage';

export const EWMA_ALPHA = 0.5;
export const UNSEEN_CONFIDENCE = 2.5;
export const LOW_CONFIDENCE = 3;
const DAY_MS = 86_400_000;

const round2 = (value: number) => Math.round(value * 100) / 100;
const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

export function computeCardStats(
  flashcards: readonly InternalFlashcard[],
  attempts: readonly PracticeAttemptRecord[],
): Map<string, CardStats> {
  const sorted = [...attempts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const stats = new Map<string, CardStats>(
    flashcards.map((card) => [
      card.id,
      {
        flashcard_id: card.id,
        attempts: 0,
        last_confidence: null,
        confidence: null,
        last_practiced_at: null,
      },
    ]),
  );
  for (const attempt of sorted) {
    const entry = stats.get(attempt.flashcard_id);
    if (!entry) continue; // attempt for a deleted card
    entry.attempts += 1;
    entry.last_confidence = attempt.confidence;
    entry.confidence =
      entry.confidence === null
        ? attempt.confidence
        : round2(EWMA_ALPHA * attempt.confidence + (1 - EWMA_ALPHA) * entry.confidence);
    entry.last_practiced_at = attempt.created_at;
  }
  return stats;
}

export interface QueueEntry {
  flashcard: InternalFlashcard;
  stats: CardStats;
  priority: number;
}

export interface QueueOptions {
  /** "weak": only cards linked to weak requirements. */
  mode?: 'all' | 'weak';
  /** Card just answered — not repeated immediately unless it is the only choice. */
  excludeId?: string;
  now?: Date;
}

/** Weakest-first practice order. */
export function orderPracticeQueue(
  kit: InternalKit,
  attempts: readonly PracticeAttemptRecord[],
  options: QueueOptions = {},
): QueueEntry[] {
  const now = (options.now ?? new Date()).getTime();
  const stats = computeCardStats(kit.flashcards, attempts);
  const must = new Set(kit.role.requirements.filter((r) => r.priority === 'must').map((r) => r.id));

  let cards = kit.flashcards;
  if (options.mode === 'weak') {
    const weak = new Set(computeWeakSpots(kit, attempts).weak_requirement_ids);
    cards = cards.filter((card) => card.requirement_ids.some((id) => weak.has(id)));
  }

  const entries = cards.map((flashcard) => {
    const s = stats.get(flashcard.id)!;
    const confidence = s.confidence ?? UNSEEN_CONFIDENCE;
    const staleness = s.last_practiced_at
      ? Math.min((now - Date.parse(s.last_practiced_at)) / (7 * DAY_MS), 1)
      : 1;
    const priority = round2(
      5 - confidence + (flashcard.requirement_ids.some((id) => must.has(id)) ? 0.5 : 0) + staleness,
    );
    return { flashcard, stats: s, priority };
  });

  entries.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.stats.attempts - b.stats.attempts ||
      Number(a.flashcard.id.slice(1)) - Number(b.flashcard.id.slice(1)),
  );
  if (options.excludeId && entries.length > 1 && entries[0]!.flashcard.id === options.excludeId) {
    entries.push(entries.shift()!);
  }
  return entries;
}

export function computeWeakSpots(
  kit: InternalKit,
  attempts: readonly PracticeAttemptRecord[],
): WeakSpotsReport {
  const stats = computeCardStats(kit.flashcards, attempts);
  const uncovered = new Set(findUncoveredRequirements(kit.role.requirements, kit.questions));

  const requirements: RequirementStrength[] = kit.role.requirements.map((requirement) => {
    const cards = kit.flashcards.filter((card) => card.requirement_ids.includes(requirement.id));
    const practised = cards
      .map((card) => stats.get(card.id)!.confidence)
      .filter((value): value is number => value !== null);
    const confidence = mean(practised);
    const reasons: WeakReason[] = [];
    if (uncovered.has(requirement.id)) reasons.push('uncovered');
    if (requirement.priority === 'must' && cards.length === 0) reasons.push('no_flashcard');
    if (confidence !== null && confidence < LOW_CONFIDENCE) reasons.push('low_confidence');
    return {
      id: requirement.id,
      text: requirement.text,
      kind: requirement.kind,
      priority: requirement.priority,
      confidence: confidence === null ? null : round2(confidence),
      flashcards: cards.length,
      practiced_flashcards: practised.length,
      weak: reasons.length > 0,
      reasons,
    };
  });

  const confidenceById = new Map(requirements.map((r) => [r.id, r.confidence]));
  const categories: CategoryStrength[] = QUESTION_CATEGORIES.map((category) => {
    const questions = kit.questions.filter((q) => q.category === category);
    const ids = new Set(questions.flatMap((q) => q.requirement_ids));
    const values = [...ids]
      .map((id) => confidenceById.get(id))
      .filter((value): value is number => value !== null && value !== undefined);
    const confidence = mean(values);
    return {
      category,
      confidence: confidence === null ? null : round2(confidence),
      questions: questions.length,
    };
  });
  const weakestCategories: QuestionCategory[] = categories
    .filter((c) => c.confidence !== null && c.confidence < 3.5)
    .sort((a, b) => a.confidence! - b.confidence!)
    .slice(0, 2)
    .map((c) => c.category);

  let weighted = 0;
  let weights = 0;
  for (const r of requirements) {
    const weight = r.priority === 'must' ? 2 : 1;
    weights += weight;
    weighted += weight * (r.confidence === null ? 0 : (r.confidence - 1) / 4);
  }

  const practisedCards = [...stats.values()].filter((s) => s.attempts > 0).length;
  return {
    readiness: weights === 0 ? 0 : Math.round((100 * weighted) / weights),
    total_flashcards: kit.flashcards.length,
    practiced_flashcards: practisedCards,
    requirements,
    weak_requirement_ids: requirements.filter((r) => r.weak).map((r) => r.id),
    categories,
    weakest_categories: weakestCategories,
    counts: {
      uncovered: uncovered.size,
      low_confidence: requirements.filter((r) => r.reasons.includes('low_confidence')).length,
      unpracticed: kit.flashcards.length - practisedCards,
    },
  };
}
