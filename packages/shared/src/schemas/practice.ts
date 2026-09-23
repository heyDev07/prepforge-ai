import { z } from 'zod';
import type { QuestionCategory, RequirementKind, RequirementPriority } from '../enums';

/** Self-reported confidence after practising a flashcard: 1 (no idea) … 5 (nailed it). */
export const ConfidenceSchema = z.number().int().min(1).max(5);

export interface PracticeAttemptRecord {
  flashcard_id: string;
  confidence: number;
  created_at: string;
}

export interface CardStats {
  flashcard_id: string;
  attempts: number;
  last_confidence: number | null;
  /** Exponentially weighted confidence (recent answers count more); null if never practised. */
  confidence: number | null;
  last_practiced_at: string | null;
}

export type WeakReason = 'uncovered' | 'no_flashcard' | 'low_confidence';

export interface RequirementStrength {
  id: string;
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
  confidence: number | null;
  flashcards: number;
  practiced_flashcards: number;
  weak: boolean;
  reasons: WeakReason[];
}

export interface CategoryStrength {
  category: QuestionCategory;
  confidence: number | null;
  questions: number;
}

export interface WeakSpotsReport {
  /** 0–100, weighted towards must-have requirements. */
  readiness: number;
  total_flashcards: number;
  practiced_flashcards: number;
  requirements: RequirementStrength[];
  weak_requirement_ids: string[];
  categories: CategoryStrength[];
  weakest_categories: QuestionCategory[];
  counts: { uncovered: number; low_confidence: number; unpracticed: number };
}
