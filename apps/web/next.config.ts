import type { NextConfig } from 'next';

/**
 * The browser only ever talks to this app's origin. /api/* is proxied to the Express API, so
 * the session cookie is first-party (SameSite=Lax works and third-party cookie blocking does
 * not apply), and no API URL or secret is exposed to the client.
 */
if (process.env.VERCEL && !process.env.API_URL) {
  // without it the deployed site would proxy to localhost and every request would fail
  throw new Error('Set API_URL (the API URL, e.g. https://prepforge-api.onrender.com) in Vercel.');
}
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
