/**
 * The only way the pipeline talks to external websites.
 *
 * Every request: validates the URL against the SSRF policy (again on every redirect hop),
 * applies a timeout, follows at most N redirects manually, rejects unexpected content types,
 * streams the body with a hard byte cap and retries only retryable failures
 * (network errors, timeouts, 408/429/5xx) with backoff + jitter and Retry-After support.
 */
import { parseRetryAfter, withRetry, type Sleep } from './backoff';
import { FetchFailure, isFetchFailure } from './errors';
import { assertUrlAllowed, parseHttpUrl, type LookupFn, type UrlPolicy } from './url-guard';

export type ExpectedContent = 'html' | 'text' | 'json';

export interface HttpRequestOptions {
  expect: ExpectedContent;
  timeoutMs: number;
  maxBytes: number;
  maxRetries: number;
  policy: UrlPolicy;
  userAgent: string;
  maxRedirects?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface HttpResponse {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface HttpClientDeps {
  fetch?: typeof fetch;
  lookup?: LookupFn;
  sleep?: Sleep;
  random?: () => number;
}

const DEFAULT_MAX_REDIRECTS = 5;
const ACCEPT_HEADERS: Record<ExpectedContent, string> = {
  html: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  text: 'text/plain,*/*;q=0.1',
  json: 'application/json',
};
const NON_RETRYABLE_NETWORK_CODES = new Set(['ENOTFOUND', 'ERR_INVALID_URL']);

function matchesExpected(contentType: string, expected: ExpectedContent): boolean {
  const mime = contentType.split(';')[0]?.trim() ?? '';
  switch (expected) {
    case 'html':
      return mime === 'text/html' || mime === 'application/xhtml+xml';
    case 'text':
      return mime === '' || mime.startsWith('text/');
    case 'json':
      return mime === 'application/json' || mime.endsWith('+json');
  }
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // ignore — we only want to free the connection
  }
}

function errorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code ?? (error as { code?: string })?.code;
}

export class HttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: HttpClientDeps = {}) {
    this.fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** GETs a URL. Throws FetchFailure on any failure (after retries for retryable ones). */
  async get(rawUrl: string, options: HttpRequestOptions): Promise<HttpResponse> {
    const url = parseHttpUrl(rawUrl);
    return withRetry(() => this.attempt(url, options), {
      maxRetries: options.maxRetries,
      backoff: { baseMs: 500, maxMs: 8_000, random: this.deps.random },
      maxWaitMs: 15_000,
      shouldRetry: (error) =>
        isFetchFailure(error) && error.retryable
          ? { retry: true, retryAfterMs: error.retryAfterMs }
          : { retry: false },
      sleep: this.deps.sleep,
      signal: options.signal,
    });
  }

  private async attempt(start: URL, options: HttpRequestOptions): Promise<HttpResponse> {
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    let current = start;

    for (let hop = 0; ; hop++) {
      await assertUrlAllowed(current, options.policy, this.deps.lookup);

      let response: Response;
      try {
        response = await this.fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          signal,
          headers: {
            'user-agent': options.userAgent,
            accept: ACCEPT_HEADERS[options.expect],
            ...options.headers,
          },
        });
      } catch (error) {
        throw this.classifyThrown(error, timeout, options);
      }

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await discard(response);
        if (hop >= maxRedirects) {
          throw new FetchFailure(
            'redirect_error',
            `Too many redirects (more than ${maxRedirects}).`,
          );
        }
        try {
          current = new URL(location, current);
        } catch {
          throw new FetchFailure('redirect_error', 'Redirect target is not a valid URL.');
        }
        continue;
      }

      if (!response.ok) {
        await discard(response);
        const status = response.status;
        throw new FetchFailure('http_error', `The server responded with HTTP ${status}.`, {
          httpStatus: status,
          retryable: status === 408 || status === 429 || status >= 500,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        });
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (!matchesExpected(contentType, options.expect)) {
        await discard(response);
        throw new FetchFailure(
          'bad_content_type',
          `Unexpected content type "${contentType || 'none'}".`,
          { httpStatus: response.status },
        );
      }

      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > options.maxBytes) {
        await discard(response);
        throw new FetchFailure('too_large', `Response exceeds ${options.maxBytes} bytes.`, {
          httpStatus: response.status,
        });
      }

      let bytes: Uint8Array;
      try {
        bytes = await this.readCapped(response, options.maxBytes);
      } catch (error) {
        if (isFetchFailure(error)) throw error;
        throw this.classifyThrown(error, timeout, options);
      }
      return {
        url: current.toString(),
        status: response.status,
        contentType,
        body: decode(bytes, contentType),
      };
    }
  }

  private async readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new FetchFailure('too_large', `Response exceeds ${maxBytes} bytes.`, {
          httpStatus: response.status,
        });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private classifyThrown(error: unknown, timeout: AbortSignal, options: HttpRequestOptions): Error {
    if (options.signal?.aborted) {
      return options.signal.reason instanceof Error ? options.signal.reason : new Error('Aborted');
    }
    if (timeout.aborted) {
      return new FetchFailure('timeout', `The request timed out after ${options.timeoutMs} ms.`, {
        retryable: true,
      });
    }
    const code = errorCode(error);
    return new FetchFailure('network_error', code ? `Network error (${code}).` : 'Network error.', {
      retryable: !(code && (NON_RETRYABLE_NETWORK_CODES.has(code) || /CERT|TLS|SSL/.test(code))),
    });
  }
}
