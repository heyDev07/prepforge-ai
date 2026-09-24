import type { NextConfig } from 'next';

/**
 * The browser only ever talks to this app's origin. /api/* is proxied to the Express API, so
 * the session cookie is first-party (SameSite=Lax works and third-party cookie blocking does
 * not apply), and no API URL or secret is exposed to the client.
 */
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
