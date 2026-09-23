/**
 * The only LLM abstraction the pipeline sees. Provider-specific code lives in its own file
 * (openai.ts, gemini.ts); everything else depends on this interface.
 */

export interface LlmRequest {
  /** Stable task name, e.g. "extract_requirements" — used for logging and the mock provider. */
  task: string;
  system: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the provider for JSON output mode (default true). */
  json?: boolean;
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  /** e.g. "stop", "length" — "length" means the output was cut off. */
  finishReason?: string | null;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorKind =
  'rate_limited' | 'quota_exceeded' | 'unavailable' | 'timeout' | 'auth' | 'bad_request';

/** A transport-level failure talking to an LLM provider. */
export class LlmTransportError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'LlmTransportError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'unavailable' || this.kind === 'timeout';
  }
}

/** Classifies an HTTP status from a provider into an error kind. */
export function kindForStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 409 || status >= 500) return 'unavailable';
  return 'bad_request';
}

/** Maps a thrown fetch error (network failure or our own timeout) to a transport error. */
export function transportErrorFromThrown(error: unknown, timeout: AbortSignal): LlmTransportError {
  if (timeout.aborted) return new LlmTransportError('timeout', 'The LLM request timed out.');
  const message = error instanceof Error ? error.message : 'Network error';
  return new LlmTransportError('unavailable', `Could not reach the LLM provider (${message}).`);
}
