/**
 * Bounded second pass:
 *   check coverage (pass 1)
 *   while must-haves are uncovered and passes < MAX_COVERAGE_PASSES:
 *     generate questions ONLY for the uncovered requirements → merge → check again (pass + 1)
 * Anything still uncovered afterwards stays listed in coverage.uncovered_requirement_ids and is
 * reported by validateKit as COVERAGE_INCOMPLETE — never silently dropped.
 */
import { isAppError, type AppError, type InternalKit } from '@prepforge/shared';
import { appendQuestions, type NewQuestion } from '../editing/merge';
import { checkCoverage } from './check-coverage';

export interface CoverageLoopOptions {
  maxPasses: number;
  /** Produces questions for exactly these uncovered requirement IDs. */
  generate: (uncoveredIds: string[], kit: InternalKit) => Promise<NewQuestion[]>;
  onPass?: (info: { pass: number; uncovered: string[] }) => void;
  onGenerate?: (uncovered: string[]) => void;
}

export interface CoverageLoopResult {
  kit: InternalKit;
  passes: number;
  added: number;
  /** Set when gap-fill generation failed; the loop stops and reports what remains. */
  error: AppError | null;
}

export async function runCoverageLoop(
  kit: InternalKit,
  options: CoverageLoopOptions,
): Promise<CoverageLoopResult> {
  let current = kit;
  let passes = 1;
  let added = 0;
  let coverage = checkCoverage(current.role.requirements, current.questions, passes);
  options.onPass?.({ pass: passes, uncovered: coverage.uncovered_requirement_ids });

  while (coverage.uncovered_requirement_ids.length > 0 && passes < options.maxPasses) {
    options.onGenerate?.(coverage.uncovered_requirement_ids);
    let drafts: NewQuestion[];
    try {
      drafts = await options.generate(coverage.uncovered_requirement_ids, current);
    } catch (error) {
      if (!isAppError(error)) throw error;
      return { kit: { ...current, coverage }, passes, added, error };
    }
    const merged = appendQuestions(current, drafts, 'gap_fill');
    current = merged.kit;
    added += merged.added.length;
    passes += 1;
    coverage = checkCoverage(current.role.requirements, current.questions, passes);
    options.onPass?.({ pass: passes, uncovered: coverage.uncovered_requirement_ids });
  }
  return { kit: { ...current, coverage }, passes, added, error: null };
}
