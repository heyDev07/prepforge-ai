/**
 * Batch evaluation over the SAME pipeline the web app uses (runPipeline).
 *
 * - Every case is processed; one failure never aborts the batch.
 * - Input IDs and input order are preserved; each case uses its own `days`.
 * - Local test servers are reachable (allowPrivateNetwork) as the assessment requires.
 * - Cases run with bounded concurrency, and all of them share one rate-limited LLM client
 *   and one research cache.
 * - Each case has a time budget; exceeding it yields a PIPELINE_TIMEOUT failure.
 */
import {
  BATCH_OUTPUT_VERSION,
  BatchCaseSchema,
  BatchOutputSchema,
  isAppError,
  KitSchema,
  type BatchKitResult,
  type BatchOutput,
  type ErrorCode,
} from '@prepforge/shared';
import {
  createLlmProvider,
  createSearchProvider,
  HttpClient,
  mapWithConcurrency,
  MemoryCache,
  runPipeline,
  toExternalKit,
  type PipelineConfig,
  type PipelineDeps,
  type StageEvent,
} from '@prepforge/pipeline';

export class BatchInputError extends Error {
  override name = 'BatchInputError';
}

export interface EvaluateOptions {
  concurrency: number;
  caseTimeoutMs: number;
  log?: (line: string) => void;
  now?: () => Date;
}

export type EvaluatorDeps = Omit<PipelineDeps, 'signal'>;

/** Pipeline dependencies for batch runs: shared LLM limiter, shared cache, local URLs allowed. */
export function createEvaluatorDeps(config: PipelineConfig): EvaluatorDeps {
  const http = new HttpClient();
  return {
    config,
    llm: createLlmProvider(config),
    http,
    search: createSearchProvider(config, http),
    policy: { allowPrivateNetwork: true },
    cache: new MemoryCache(),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function failure(id: string, code: ErrorCode, message: string): BatchKitResult {
  return { id, status: 'failed', kit: null, error: { code, message } };
}

function describeError(error: unknown, signal: AbortSignal): { code: ErrorCode; message: string } {
  if (signal.aborted) {
    return { code: 'PIPELINE_TIMEOUT', message: 'The case exceeded its time budget.' };
  }
  if (isAppError(error)) return { code: error.code, message: error.message };
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred while building the kit.',
  };
}

async function evaluateCase(
  raw: unknown,
  index: number,
  deps: EvaluatorDeps,
  options: EvaluateOptions,
): Promise<BatchKitResult> {
  const log = options.log ?? (() => undefined);
  const parsedCase = BatchCaseSchema.safeParse(raw);
  const rawId = (raw as { id?: unknown } | null)?.id;
  const id = parsedCase.success
    ? parsedCase.data.id
    : typeof rawId === 'string' && rawId.trim()
      ? rawId
      : `case-${index + 1}`;
  if (!parsedCase.success) {
    log(`[${id}] invalid case: every case needs a non-empty string "id"`);
    return failure(
      id,
      'INVALID_INPUT',
      'Each case must be an object with a non-empty string "id".',
    );
  }

  const { jd, company_url, days } = parsedCase.data;
  const signal = AbortSignal.timeout(options.caseTimeoutMs);
  const started = Date.now();
  const onStage = (event: StageEvent) => {
    if (event.status === 'running' && event.detail === null) log(`[${id}] ${event.stage}`);
  };

  try {
    const result = await runPipeline({ jd, company_url, days }, { ...deps, signal }, onStage);
    const kit = KitSchema.parse(toExternalKit(result.kit)); // exact Appendix A shape
    const gaps = kit.coverage.uncovered_requirement_ids;
    log(
      `[${id}] ok in ${((Date.now() - started) / 1000).toFixed(1)}s — ${kit.questions.length} questions, ` +
        `${kit.flashcards.length} flashcards, ${plural(kit.schedule.days.length, 'day')}` +
        (gaps.length ? `, UNCOVERED must-haves: ${gaps.join(', ')}` : ''),
    );
    return { id, status: 'ok', kit, error: null };
  } catch (error) {
    const { code, message } = describeError(error, signal);
    log(`[${id}] failed: ${code} — ${message}`);
    return failure(id, code, message);
  }
}

export async function evaluateCases(
  input: unknown,
  deps: EvaluatorDeps,
  options: EvaluateOptions,
): Promise<BatchOutput> {
  if (!Array.isArray(input)) {
    throw new BatchInputError('The input file must contain a JSON array of cases.');
  }
  const kits = await mapWithConcurrency(input, options.concurrency, (raw, index) =>
    evaluateCase(raw, index, deps, options),
  );
  return BatchOutputSchema.parse({
    version: BATCH_OUTPUT_VERSION,
    generated_at: (options.now ?? (() => new Date()))().toISOString(),
    kits,
  });
}
