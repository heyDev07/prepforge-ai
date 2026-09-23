import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

/** Starts a throwaway HTTP server on a random localhost port. */
export async function startTestServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Returns a localhost URL on which nothing is listening. */
export async function unusedLocalUrl(): Promise<string> {
  const server = await startTestServer(() => undefined);
  await server.close();
  return server.url;
}
