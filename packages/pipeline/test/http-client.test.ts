import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FetchFailure } from '../src/net/errors';
import { HttpClient, type HttpRequestOptions } from '../src/net/http-client';
import { startTestServer, unusedLocalUrl, type TestServer } from './support/http-server';

const baseOptions: HttpRequestOptions = {
  expect: 'html',
  timeoutMs: 1_000,
  maxBytes: 10_000,
  maxRetries: 2,
  policy: { allowPrivateNetwork: true },
  userAgent: 'PrepForgeBot/test',
};

let server: TestServer;
const hits = new Map<string, number>();

beforeAll(async () => {
  server = await startTestServer((req, res) => {
    const path = req.url ?? '/';
    const count = (hits.get(path) ?? 0) + 1;
    hits.set(path, count);
    const html = (body: string) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    switch (path) {
      case '/ok':
        return html(`<h1>Hello</h1><p>ua=${req.headers['user-agent']}</p>`);
      case '/redirect':
        res.writeHead(301, { location: '/ok' });
        return res.end();
      case '/loop-a':
        res.writeHead(302, { location: '/loop-b' });
        return res.end();
      case '/loop-b':
        res.writeHead(302, { location: '/loop-a' });
        return res.end();
      case '/missing':
        res.writeHead(404, { 'content-type': 'text/html' });
        return res.end('not found');
      case '/flaky':
        if (count <= 2) {
          res.writeHead(503);
          return res.end();
        }
        return html('recovered');
      case '/rate-limited':
        if (count === 1) {
          res.writeHead(429, { 'retry-after': '3' });
          return res.end();
        }
        return html('after wait');
      case '/slow': {
        const timer = setTimeout(() => html('too late'), 2_000);
        res.on('close', () => clearTimeout(timer));
        return;
      }
      case '/declared-large':
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': '50000' });
        return res.end('x'.repeat(50_000));
      case '/streamed-large':
        res.writeHead(200, { 'content-type': 'text/html' });
        for (let i = 0; i < 20; i++) res.write('y'.repeat(1_000));
        return res.end();
      case '/pdf':
        res.writeHead(200, { 'content-type': 'application/pdf' });
        return res.end('%PDF-1.4');
      case '/json':
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{"ok":true}');
      default:
        res.writeHead(500);
        return res.end();
    }
  });
});

afterAll(() => server.close());

function client() {
  const sleep = vi.fn(async (_ms: number) => undefined);
  return { http: new HttpClient({ sleep, random: () => 0.5 }), sleep };
}

async function failureOf(promise: Promise<unknown>): Promise<FetchFailure> {
  try {
    await promise;
  } catch (error) {
    return error as FetchFailure;
  }
  throw new Error('expected a failure');
}

describe('HttpClient', () => {
  it('fetches HTML and sends the configured user agent', async () => {
    const { http } = client();
    const response = await http.get(`${server.url}/ok`, baseOptions);
    expect(response.status).toBe(200);
    expect(response.body).toContain('ua=PrepForgeBot/test');
  });

  it('follows redirects and reports the final URL', async () => {
    const { http } = client();
    const response = await http.get(`${server.url}/redirect`, baseOptions);
    expect(response.url).toBe(`${server.url}/ok`);
  });

  it('stops redirect loops', async () => {
    const { http } = client();
    const failure = await failureOf(http.get(`${server.url}/loop-a`, baseOptions));
    expect(failure.status).toBe('redirect_error');
  });

  it('does not retry a 404', async () => {
    const { http, sleep } = client();
    const failure = await failureOf(http.get(`${server.url}/missing`, baseOptions));
    expect(failure).toMatchObject({ status: 'http_error', httpStatus: 404, retryable: false });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries 5xx responses with backoff and then succeeds', async () => {
    const { http, sleep } = client();
    const response = await http.get(`${server.url}/flaky`, baseOptions);
    expect(response.body).toBe('recovered');
    expect(hits.get('/flaky')).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500]);
  });

  it('honours Retry-After on 429', async () => {
    const { http, sleep } = client();
    await http.get(`${server.url}/rate-limited`, baseOptions);
    expect(sleep.mock.calls[0]![0]).toBeGreaterThanOrEqual(3_000);
  });

  it('times out slow responses and retries them', async () => {
    const { http, sleep } = client();
    const failure = await failureOf(
      http.get(`${server.url}/slow`, { ...baseOptions, timeoutMs: 100, maxRetries: 1 }),
    );
    expect(failure.status).toBe('timeout');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('rejects bodies over the byte limit (declared and streamed)', async () => {
    const { http } = client();
    expect((await failureOf(http.get(`${server.url}/declared-large`, baseOptions))).status).toBe(
      'too_large',
    );
    expect((await failureOf(http.get(`${server.url}/streamed-large`, baseOptions))).status).toBe(
      'too_large',
    );
  });

  it('rejects unexpected content types', async () => {
    const { http } = client();
    const failure = await failureOf(http.get(`${server.url}/pdf`, baseOptions));
    expect(failure.status).toBe('bad_content_type');
    const json = await http.get(`${server.url}/json`, { ...baseOptions, expect: 'json' });
    expect(JSON.parse(json.body)).toEqual({ ok: true });
  });

  it('reports connection failures as network errors after retrying', async () => {
    const { http, sleep } = client();
    const failure = await failureOf(http.get(`${await unusedLocalUrl()}/`, baseOptions));
    expect(failure.status).toBe('network_error');
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('blocks localhost under the production policy without sending a request', async () => {
    const { http } = client();
    const before = hits.get('/ok') ?? 0;
    const failure = await failureOf(
      http.get(`${server.url}/ok`, { ...baseOptions, policy: { allowPrivateNetwork: false } }),
    );
    expect(failure.status).toBe('blocked_url');
    expect(hits.get('/ok') ?? 0).toBe(before);
  });

  it('re-checks every redirect hop against the SSRF policy', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    const http = new HttpClient({
      fetch: fakeFetch as unknown as typeof fetch,
      lookup: async () => ['93.184.216.34'],
    });
    const failure = await failureOf(
      http.get('https://acme.example/', { ...baseOptions, policy: { allowPrivateNetwork: false } }),
    );
    expect(failure.status).toBe('blocked_url');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});
