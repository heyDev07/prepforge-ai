/**
 * Coverage and schedule are DERIVED sections: they hold no user edits and are recomputed
 * deterministically whenever questions, requirements or days change.
 */
import type { InternalKit } from '@prepforge/shared';
import { checkCoverage } from '../coverage/check-coverage';
import { allocateSchedule } from '../schedule/allocate';

export interface DeriveOptions {
  /** Requirements with low practice confidence (from Weak Spots); boosted in the schedule. */
  weakRequirementIds?: ReadonlySet<string>;
  /** Coverage passes of the most recent coverage loop; kept unchanged when omitted. */
  passes?: number;
  daysAvailable?: number;
}

export function refreshDerived(kit: InternalKit, options: DeriveOptions = {}): InternalKit {
  const days = options.daysAvailable ?? kit.schedule.days_available;
  return {
    ...kit,
    coverage: checkCoverage(
      kit.role.requirements,
      kit.questions,
      options.passes ?? kit.coverage.passes,
    ),
    schedule: allocateSchedule({
      daysAvailable: days,
      requirements: kit.role.requirements,
      questions: kit.questions,
      flashcardCount: kit.flashcards.length,
      weakRequirementIds: options.weakRequirementIds,
    }),
  };
}
