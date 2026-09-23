/**
 * OpenAI Chat Completions provider (default). Also works with OpenAI-compatible endpoints via
 * LLM_BASE_URL. Uses JSON mode; the response is still validated by structured-call.
 */
import { parseRetryAfter } from '../net/backoff';
import {
  kindForStatus,
  LlmTransportError,
  transportErrorFromThrown,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from './provider';

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAiErrorBody {
  error?: { message?: string; code?: string | null; param?: string | null; type?: string };
}

/** Out-of-credit / billing errors also arrive as HTTP 429 but must not be retried. */
const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'billing_hard_limit_reached',
  'billing_not_active',
]);

function isQuotaError(payload: OpenAiErrorBody): boolean {
  return payload.error?.type === 'insufficient_quota' || QUOTA_CODES.has(payload.error?.code ?? '');
}

export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  /** Some models (e.g. reasoning models) reject `temperature`; learned on first rejection. */
  private temperatureSupported = true;

  constructor(private readonly options: OpenAiOptions) {
    this.model = options.model;
    this.endpoint = `${(options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    };
    if (request.json !== false) body.response_format = { type: 'json_object' };
    if (request.maxOutputTokens) body.max_completion_tokens = request.maxOutputTokens;
    if (request.temperature !== undefined && this.temperatureSupported) {
      body.temperature = request.temperature;
    }

    try {
      return await this.send(body, request.signal);
    } catch (error) {
      const unsupportedTemperature =
        error instanceof LlmTransportError &&
        error.kind === 'bad_request' &&
        'temperature' in body &&
        /temperature/i.test(error.message);
      if (!unsupportedTemperature) throw error;
      this.temperatureSupported = false;
      delete body.temperature;
      return this.send(body, request.signal);
    }
  }

  private async send(body: Record<string, unknown>, signal?: AbortSignal): Promise<LlmResponse> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw transportErrorFromThrown(error, timeout);
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as OpenAiErrorBody;
      const detail = payload.error?.message?.slice(0, 300) ?? `HTTP ${response.status}`;
      let kind = kindForStatus(response.status);
      if (kind === 'rate_limited' && isQuotaError(payload)) kind = 'quota_exceeded';
      // OpenAI sends retry-after-ms (milliseconds) and/or the standard Retry-After header.
      const retryAfterMsHeader = Number(response.headers.get('retry-after-ms'));
      const retryAfterMs =
        Number.isFinite(retryAfterMsHeader) && retryAfterMsHeader > 0
          ? retryAfterMsHeader
          : parseRetryAfter(response.headers.get('retry-after'));
      const param = payload.error?.param ? ` (param: ${payload.error.param})` : '';
      throw new LlmTransportError(kind, `OpenAI: ${detail}${param}`, response.status, retryAfterMs);
    }

    const data = (await response.json()) as ChatCompletion;
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      finishReason: choice?.finish_reason ?? null,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}
