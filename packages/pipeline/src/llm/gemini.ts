/** Google Gemini provider (LLM_PROVIDER=gemini) via the generateContent REST API. */
import { parseRetryAfter } from '../net/backoff';
import {
  kindForStatus,
  LlmTransportError,
  transportErrorFromThrown,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from './provider';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

interface GeminiErrorBody {
  error?: {
    message?: string;
    status?: string;
    details?: Array<{ '@type'?: string; retryDelay?: string }>;
  };
}

/** "31s" / "1.5s" → milliseconds */
function parseRetryDelay(value: string | undefined): number | null {
  const match = value ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null;
  return match?.[1] ? Math.round(Number(match[1]) * 1000) : null;
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly fetchImpl: typeof fetch;
  /**
   * Low thinking keeps structured calls fast and stops hidden reasoning tokens from eating the
   * output budget. Models that reject the setting get it dropped after the first refusal.
   */
  private thinkingSupported = true;

  constructor(private readonly options: GeminiOptions) {
    this.model = options.model;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    if (!this.thinkingSupported) return this.send(request, false);
    try {
      return await this.send(request, true);
    } catch (error) {
      if (!(error instanceof LlmTransportError) || error.kind !== 'bad_request') throw error;
      this.thinkingSupported = false;
      return this.send(request, false);
    }
  }

  private async send(request: LlmRequest, lowThinking: boolean): Promise<LlmResponse> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.maxOutputTokens) generationConfig.maxOutputTokens = request.maxOutputTokens;
    if (request.json !== false) generationConfig.responseMimeType = 'application/json';
    if (lowThinking) generationConfig.thinkingConfig = { thinkingLevel: 'low' };

    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig,
        }),
        signal: request.signal ? AbortSignal.any([timeout, request.signal]) : timeout,
      });
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      throw transportErrorFromThrown(error, timeout);
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as GeminiErrorBody;
      const retryInfo = payload.error?.details?.find((d) => d['@type']?.endsWith('RetryInfo'));
      const retryAfterMs =
        parseRetryDelay(retryInfo?.retryDelay) ??
        parseRetryAfter(response.headers.get('retry-after'));
      const detail = payload.error?.message?.slice(0, 300) ?? `HTTP ${response.status}`;
      throw new LlmTransportError(
        kindForStatus(response.status),
        `Gemini: ${detail}`,
        response.status,
        retryAfterMs,
      );
    }

    const data = (await response.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const finish = candidate?.finishReason ?? null;
    return {
      text: (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join(''),
      finishReason: finish === 'MAX_TOKENS' ? 'length' : (finish?.toLowerCase() ?? null),
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
