import { AppError } from '@prepforge/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadPipelineConfig } from '../src/config';
import { createLlmProvider } from '../src/llm/factory';
import { GeminiProvider } from '../src/llm/gemini';
import { LimitedLlmProvider } from '../src/llm/limited-provider';
import { MockLlmProvider } from '../src/llm/mock';
import { OpenAiProvider } from '../src/llm/openai';
import { LlmTransportError, type LlmRequest } from '../src/llm/provider';
import { callStructured, extractJson } from '../src/llm/structured-call';

const request: LlmRequest = { task: 't', system: 'sys', user: 'usr', temperature: 0 };
const Schema = z.object({ items: z.array(z.string()).min(1) });
const noSleep = async () => undefined;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('extractJson', () => {
  it.each([
    ['{"items":["a"]}'],
    ['```json\n{"items":["a"]}\n```'],
    ['Sure! Here you go:\n{"items":["a"]}\nHope that helps.'],
  ])('extracts JSON from %j', (text) => {
    expect(extractJson(text)).toEqual({ items: ['a'] });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('no json here')).toThrow(SyntaxError);
  });
});

describe('callStructured', () => {
  const spec = { task: 'demo', system: 'sys', user: 'give items', schema: Schema, temperature: 0 };

  it('returns validated data on the first try', async () => {
    const llm = new MockLlmProvider({ demo: '{"items":["a","b"]}' });
    await expect(callStructured(llm, spec)).resolves.toEqual({ items: ['a', 'b'] });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.json).toBe(true);
  });

  it('retries once with the validation problems and accepts a corrected reply', async () => {
    const llm = new MockLlmProvider({ demo: '{"items":[]}', 'demo:retry': '{"items":["fixed"]}' });
    await expect(callStructured(llm, spec)).resolves.toEqual({ items: ['fixed'] });
    const retry = llm.calls[1]!;
    expect(retry.user).toContain('give items');
    expect(retry.user).toContain('items: Too small');
    expect(retry.user).toContain('Reply again with ONLY a JSON object');
  });

  it('explains invalid JSON and cut-off replies in the corrective prompt', async () => {
    const llm = new MockLlmProvider({
      demo: { text: '{"items":["a"', finishReason: 'length' },
      'demo:retry': '{"items":["a"]}',
    });
    await callStructured(llm, spec);
    expect(llm.calls[1]!.user).toContain('not valid JSON');
    expect(llm.calls[1]!.user).toContain('cut off');
  });

  it('fails with a structured LLM_INVALID_OUTPUT after two invalid replies', async () => {
    const llm = new MockLlmProvider({ demo: 'nonsense', 'demo:retry': '{"items":"nope"}' });
    const error = await callStructured(llm, spec).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'LLM_INVALID_OUTPUT', retryable: true });
    expect(llm.calls).toHaveLength(2);
  });
});

describe('LimitedLlmProvider', () => {
  it('retries rate limits, honouring Retry-After', async () => {
    const sleep = vi.fn(noSleep);
    const inner = new MockLlmProvider({
      t: [new LlmTransportError('rate_limited', '429', 429, 7_000), 'ok'],
    });
    const llm = new LimitedLlmProvider(inner, {
      maxConcurrency: 1,
      requestsPerMinute: 100,
      maxRetries: 3,
      sleep,
      random: () => 0,
    });
    await expect(llm.generate(request)).resolves.toMatchObject({ text: 'ok' });
    expect(sleep).toHaveBeenCalledWith(7_000, undefined);
  });

  it.each([
    ['auth', 'LLM_NOT_CONFIGURED', false],
    ['quota_exceeded', 'LLM_RATE_LIMITED', false],
    ['bad_request', 'LLM_UNAVAILABLE', false],
  ] as const)('does not retry %s and maps it to %s', async (kind, code, retryable) => {
    const inner = new MockLlmProvider({ t: new LlmTransportError(kind, 'x') });
    const llm = new LimitedLlmProvider(inner, {
      maxConcurrency: 1,
      requestsPerMinute: 100,
      maxRetries: 3,
      sleep: noSleep,
    });
    await expect(llm.generate(request)).rejects.toMatchObject({ code, retryable });
    expect(inner.calls).toHaveLength(1);
  });

  it('gives up after maxRetries with a retryable structured error', async () => {
    const inner = new MockLlmProvider({ t: new LlmTransportError('unavailable', '503', 503) });
    const llm = new LimitedLlmProvider(inner, {
      maxConcurrency: 1,
      requestsPerMinute: 100,
      maxRetries: 2,
      sleep: noSleep,
    });
    await expect(llm.generate(request)).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
      retryable: true,
    });
    expect(inner.calls).toHaveLength(3);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const inner = new MockLlmProvider(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return 'ok';
    });
    const llm = new LimitedLlmProvider(inner, {
      maxConcurrency: 2,
      requestsPerMinute: 1_000,
      maxRetries: 0,
    });
    await Promise.all(Array.from({ length: 8 }, () => llm.generate(request)));
    expect(peak).toBe(2);
  });

  it('spaces requests to respect requests-per-minute', async () => {
    let time = 0;
    const waits: number[] = [];
    const llm = new LimitedLlmProvider(new MockLlmProvider(() => 'ok'), {
      maxConcurrency: 4,
      requestsPerMinute: 2,
      maxRetries: 0,
      now: () => time,
      sleep: async (ms) => {
        waits.push(ms);
        time += ms;
      },
    });
    await Promise.all([llm.generate(request), llm.generate(request), llm.generate(request)]);
    expect(waits).toEqual([60_000]);
  });
});

describe('OpenAiProvider', () => {
  it('sends a JSON-mode chat completion and parses the reply', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body).toMatchObject({
        model: 'gpt-test',
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'usr' },
        ],
      });
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
      return jsonResponse({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      });
    });
    const provider = new OpenAiProvider({
      apiKey: 'sk-test',
      model: 'gpt-test',
      timeoutMs: 1_000,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await expect(provider.generate(request)).resolves.toEqual({
      text: '{"ok":true}',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 3 },
    });
    expect(fetch.mock.calls[0]![0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('classifies rate limits, quota errors and Retry-After headers', async () => {
    const make = (response: Response) =>
      new OpenAiProvider({
        apiKey: 'k',
        model: 'm',
        timeoutMs: 1_000,
        fetch: (async () => response) as unknown as typeof fetch,
      });
    const limited = await make(
      jsonResponse(
        { error: { message: 'slow down' } },
        { status: 429, headers: { 'retry-after-ms': '1500' } },
      ),
    )
      .generate(request)
      .catch((e: LlmTransportError) => e);
    expect(limited).toMatchObject({ kind: 'rate_limited', retryAfterMs: 1_500, retryable: true });

    const quota = await make(
      jsonResponse(
        { error: { message: 'no credit', code: 'insufficient_quota' } },
        { status: 429 },
      ),
    )
      .generate(request)
      .catch((e: LlmTransportError) => e);
    expect(quota).toMatchObject({ kind: 'quota_exceeded', retryable: false });

    const noCredit = await make(
      jsonResponse(
        {
          error: {
            message: 'You have no credits remaining.',
            type: 'insufficient_quota',
            code: 'credit_balance_exhausted',
          },
        },
        { status: 429 },
      ),
    )
      .generate(request)
      .catch((e: LlmTransportError) => e);
    expect(noCredit).toMatchObject({ kind: 'quota_exceeded', retryable: false });
  });

  it('drops temperature for models that reject it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      if ('temperature' in body) {
        return jsonResponse(
          { error: { message: "Unsupported value: 'temperature'", param: 'temperature' } },
          { status: 400 },
        );
      }
      return jsonResponse({ choices: [{ message: { content: '{}' } }] });
    };
    const provider = new OpenAiProvider({
      apiKey: 'k',
      model: 'm',
      timeoutMs: 1_000,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await provider.generate(request);
    await provider.generate(request);
    expect(bodies.map((b) => 'temperature' in b)).toEqual([true, false, false]);
  });
});

describe('GeminiProvider', () => {
  it('reads RetryInfo delays and response text', async () => {
    const limited = new GeminiProvider({
      apiKey: 'k',
      model: 'gemini-test',
      timeoutMs: 1_000,
      fetch: (async () =>
        jsonResponse(
          {
            error: {
              message: 'quota',
              details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31s' }],
            },
          },
          { status: 429 },
        )) as unknown as typeof fetch,
    });
    await expect(limited.generate(request)).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 31_000,
    });

    const ok = new GeminiProvider({
      apiKey: 'k',
      model: 'gemini-test',
      timeoutMs: 1_000,
      fetch: (async () =>
        jsonResponse({
          candidates: [
            { content: { parts: [{ text: '{"a":' }, { text: '1}' }] }, finishReason: 'STOP' },
          ],
        })) as unknown as typeof fetch,
    });
    await expect(ok.generate(request)).resolves.toMatchObject({
      text: '{"a":1}',
      finishReason: 'stop',
    });
  });
});

describe('GeminiProvider thinking level', () => {
  it('asks for low thinking and drops it for models that reject the setting', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { generationConfig: Record<string, unknown> };
      bodies.push(body.generationConfig);
      if (body.generationConfig.thinkingConfig) {
        return jsonResponse(
          { error: { message: 'Request contains an invalid argument.' } },
          { status: 400 },
        );
      }
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }],
      });
    };
    const provider = new GeminiProvider({
      apiKey: 'k',
      model: 'gemini-lite',
      timeoutMs: 1_000,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await provider.generate(request);
    await provider.generate(request);
    expect(bodies.map((b) => 'thinkingConfig' in b)).toEqual([true, false, false]);
    expect(bodies[0]!.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });
});

describe('createLlmProvider', () => {
  it('fails each call with LLM_NOT_CONFIGURED when the API key is missing', async () => {
    const llm = createLlmProvider(loadPipelineConfig({ LLM_PROVIDER: 'openai' }));
    await expect(llm.generate(request)).rejects.toMatchObject({
      code: 'LLM_NOT_CONFIGURED',
      message: 'OPENAI_API_KEY is not set.',
    });
  });

  it('uses the scripted mock provider when configured', async () => {
    const llm = createLlmProvider(loadPipelineConfig({ LLM_PROVIDER: 'mock' }), {
      mockScript: { t: '{"hello":"world"}' },
    });
    await expect(llm.generate(request)).resolves.toMatchObject({ text: '{"hello":"world"}' });
  });
});
