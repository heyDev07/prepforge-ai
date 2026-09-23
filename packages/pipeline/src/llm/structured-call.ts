/**
 * Never trust raw model output:
 *
 *   call LLM → extract JSON → parse → Zod validate
 *     └ invalid → ONE corrective retry that includes the validation problems
 *          └ still invalid → AppError LLM_INVALID_OUTPUT (structured, retryable)
 */
import { AppError } from '@prepforge/shared';
import type { z } from 'zod';
import type { LlmProvider } from './provider';

export interface StructuredCallSpec<T> {
  task: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

const MAX_ISSUES_SHOWN = 12;
const MAX_PREVIOUS_REPLY_CHARS = 1_500;

/** Extracts the JSON value from a model reply, tolerating code fences and surrounding prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[{[]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start === -1 || end <= start) throw new SyntaxError('No JSON object found in the reply.');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

type Attempt<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function evaluate<T>(
  text: string,
  finishReason: string | null | undefined,
  schema: z.ZodType<T>,
): Attempt<T> {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (error) {
    const problems = [`The reply was not valid JSON (${(error as Error).message}).`];
    if (finishReason === 'length') problems.push('The reply was cut off. Keep it shorter.');
    return { ok: false, problems };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const problems = result.error.issues
    .slice(0, MAX_ISSUES_SHOWN)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`);
  if (result.error.issues.length > MAX_ISSUES_SHOWN) {
    problems.push(`…and ${result.error.issues.length - MAX_ISSUES_SHOWN} more problem(s).`);
  }
  return { ok: false, problems };
}

export async function callStructured<T>(llm: LlmProvider, spec: StructuredCallSpec<T>): Promise<T> {
  const base = {
    task: spec.task,
    system: spec.system,
    temperature: spec.temperature,
    maxOutputTokens: spec.maxOutputTokens,
    json: true,
    signal: spec.signal,
  };

  const first = await llm.generate({ ...base, user: spec.user });
  const firstAttempt = evaluate(first.text, first.finishReason, spec.schema);
  if (firstAttempt.ok) return firstAttempt.value;

  const corrective = [
    spec.user,
    '',
    '---',
    'Your previous reply could not be used because:',
    ...firstAttempt.problems.map((problem) => `- ${problem}`),
    '',
    'Previous reply (truncated):',
    first.text.slice(0, MAX_PREVIOUS_REPLY_CHARS),
    '',
    'Reply again with ONLY a JSON object that follows the required format exactly.',
  ].join('\n');

  const second = await llm.generate({ ...base, user: corrective, task: `${spec.task}:retry` });
  const secondAttempt = evaluate(second.text, second.finishReason, spec.schema);
  if (secondAttempt.ok) return secondAttempt.value;

  throw new AppError(
    'LLM_INVALID_OUTPUT',
    `The model returned invalid output for "${spec.task}" twice.`,
    { retryable: true, status: 502, details: { problems: secondAttempt.problems } },
  );
}
