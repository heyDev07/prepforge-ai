'use client';

import type { InternalKit, KitDetailDto } from '@prepforge/shared';
import { createContext, useContext } from 'react';

export interface BuilderContextValue {
  id: string;
  detail: KitDetailDto;
  kit: InternalKit;
  /** A regeneration job is running: editing is disabled until it finishes. */
  busy: boolean;
}

export const BuilderContext = createContext<BuilderContextValue | null>(null);

export function useBuilder(): BuilderContextValue {
  const value = useContext(BuilderContext);
  if (!value) throw new Error('useBuilder must be used inside the kit builder');
  return value;
}

/** Requirement text by id, for badges and tooltips. */
export function useRequirementMap() {
  const { kit } = useBuilder();
  return new Map(kit.role.requirements.map((r) => [r.id, r]));
}
