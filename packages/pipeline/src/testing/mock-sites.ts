/**
 * Serves the fake company websites in fixtures/mock-sites, each on its own localhost port
 * (robots.txt must live at the root of an origin). Used by tests, the batch-evaluator demo and
 * `npm run mock-sites`.
 *
 * A site may contain `_routes.json` to simulate failures:
 *   { "/path": { "status", "body", "contentType", "delayMs", "bytes", "redirect", "failTimes", "failStatus" } }
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MOCK_SITES_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../fixtures/mock-sites',
);

export const MOCK_SITE_NAMES = [
  'acme-careers',
  'no-careers',
  'nested-hiring',
  'broken',
  'relative-links',
  'robots-restricted',
  'injection',
] as const;
export type MockSiteName = (typeof MOCK_SITE_NAMES)[number];

interface RouteBehaviour {
  status?: number;
  body?: string;
  contentType?: string;
  delayMs?: number;
  bytes?: number;
  redirect?: string;
  failTimes?: number;
  failStatus?: number;
}

export interface MockSitesHandle {
  /** Base URL (with trailing slash) for each started site. */
  urls: Record<MockSiteName, string>;
  /** Number of requests each site received per path. */
  hits: Record<MockSiteName, Map<string, number>>;
  close: () => Promise<void>;
}

function resolveFile(siteDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const clean = normalize(decoded).replace(/^([/\\])+/, '');
  const candidates =
    clean === '' || clean.endsWith(sep)
      ? [join(clean, 'index.html')]
      : [clean, `${clean}.html`, join(clean, 'index.html')];
  for (const candidate of candidates) {
    const full = resolve(siteDir, candidate);
    if (!full.startsWith(siteDir + sep)) return null; // path traversal
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}

function contentTypeFor(file: string): string {
  if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json';
  return 'text/html; charset=utf-8';
}

function sendFile(res: ServerResponse, file: string | null): void {
  if (!file || file.endsWith('_routes.json')) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>Not found</h1>');
    return;
  }
  res.writeHead(200, { 'content-type': contentTypeFor(file) });
  res.end(readFileSync(file));
}

function createSiteServer(siteDir: string, hits: Map<string, number>): Server {
  const routesFile = join(siteDir, '_routes.json');
  const routes: Record<string, RouteBehaviour> = existsSync(routesFile)
    ? JSON.parse(readFileSync(routesFile, 'utf8'))
    : {};

  return createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://mock.local');
    const count = (hits.get(pathname) ?? 0) + 1;
    hits.set(pathname, count);
    const route = routes[pathname];
    const file = resolveFile(siteDir, pathname);

    if (!route) return sendFile(res, file);

    if (route.failTimes && count <= route.failTimes) {
      res.writeHead(route.failStatus ?? 503, { 'content-type': 'text/html' });
      res.end('temporarily unavailable');
      return;
    }
    if (route.redirect) {
      res.writeHead(302, { location: route.redirect });
      res.end();
      return;
    }
    if (route.bytes) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      // like a real site-builder page: readable content first, then megabytes of inline script
      res.write(
        '<!doctype html><html><head><title>Employee handbook</title></head><body>' +
          '<h1>Employee handbook</h1><p>How we plan, review and ship work at this company.</p>',
      );
      const chunk = '<script>/*' + 'x'.repeat(1_000) + '*/</script>';
      let sent = 0;
      const write = () => {
        while (sent < route.bytes!) {
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', write);
            return;
          }
        }
        res.end();
      };
      res.on('error', () => undefined);
      write();
      return;
    }
    const respond = () => {
      if (route.status !== undefined || route.body !== undefined || route.contentType) {
        res.writeHead(route.status ?? 200, {
          'content-type': route.contentType ?? 'text/html; charset=utf-8',
        });
        res.end(route.body ?? '');
      } else {
        sendFile(res, file);
      }
    };
    if (route.delayMs) {
      const timer = setTimeout(respond, route.delayMs);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    respond();
  });
}

/** Starts the requested mock sites (all by default). Pass ports to pin them (0 = random). */
export async function startMockSites(
  options: { sites?: readonly MockSiteName[]; ports?: Partial<Record<MockSiteName, number>> } = {},
): Promise<MockSitesHandle> {
  const names = options.sites ?? MOCK_SITE_NAMES;
  const servers: Server[] = [];
  const urls = {} as Record<MockSiteName, string>;
  const hits = {} as Record<MockSiteName, Map<string, number>>;

  for (const name of names) {
    hits[name] = new Map();
    const server = createSiteServer(join(MOCK_SITES_DIR, name), hits[name]);
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(options.ports?.[name] ?? 0, '127.0.0.1', () => resolveListen());
    });
    servers.push(server);
    urls[name] = `http://localhost:${(server.address() as AddressInfo).port}/`;
  }

  return {
    urls,
    hits,
    close: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolveClose) => {
              server.closeAllConnections();
              server.close(() => resolveClose());
            }),
        ),
      );
    },
  };
}
