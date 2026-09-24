import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Session, User } from '../src/models';
import { signedInAgent, startHarness, WEB_ORIGIN, type Harness } from './support/harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe('health and error shape', () => {
  it('reports health', async () => {
    const res = await supertest(h.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await supertest(h.app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns structured JSON errors for unknown routes and invalid JSON', async () => {
    const missing = await supertest(h.app).get('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: 'NOT_FOUND', retryable: false });

    const broken = await supertest(h.app)
      .post('/api/auth/login')
      .set('content-type', 'application/json')
      .send('{ bad json');
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects oversized bodies', async () => {
    const res = await supertest(h.app)
      .post('/api/auth/register')
      .send({ email: 'big@example.com', password: 'x'.repeat(300_000) });
    expect(res.status).toBe(413);
  });
});

describe('register, login, logout, me', () => {
  it('registers, sets an HttpOnly SameSite=Lax cookie and stores only a bcrypt hash', async () => {
    const res = await supertest(h.app)
      .post('/api/auth/register')
      .send({ email: '  New.User@Example.com ', password: 'correct horse battery' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'new.user@example.com' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/pf_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const stored = await User.findOne({ email: 'new.user@example.com' }).lean();
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(stored!.passwordHash).not.toContain('correct horse');
    const session = await Session.findOne({ userId: stored!._id }).lean();
    expect(cookie).not.toContain(session!.tokenHash);
  });

  it('rejects a duplicate email and invalid input', async () => {
    await signedInAgent(h.app, 'taken@example.com');
    const dup = await supertest(h.app)
      .post('/api/auth/register')
      .send({ email: 'TAKEN@example.com', password: 'another password' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');

    const bad = await supertest(h.app)
      .post('/api/auth/register')
      .send({ email: 'nope', password: 'short' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_INPUT');
  });

  it('logs in, and gives the same answer for an unknown email and a wrong password', async () => {
    await signedInAgent(h.app, 'login@example.com');
    const ok = await supertest(h.app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'correct horse battery' });
    expect(ok.status).toBe(200);

    const wrong = await supertest(h.app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'wrong password' });
    const unknown = await supertest(h.app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'wrong password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('protects /me and revokes the session on logout', async () => {
    expect((await supertest(h.app).get('/api/auth/me')).status).toBe(401);

    const agent = await signedInAgent(h.app, 'me@example.com');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('me@example.com');

    const cookie = (
      await supertest(h.app)
        .post('/api/auth/login')
        .send({ email: 'me@example.com', password: 'correct horse battery' })
    ).headers['set-cookie']!;
    expect((await supertest(h.app).get('/api/auth/me').set('cookie', cookie)).status).toBe(200);
    expect((await supertest(h.app).post('/api/auth/logout').set('cookie', cookie)).status).toBe(
      204,
    );
    // the old cookie no longer works, even if the browser kept it
    expect((await supertest(h.app).get('/api/auth/me').set('cookie', cookie)).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const res = await supertest(h.app).get('/api/auth/me').set('cookie', 'pf_session=forged-token');
    expect(res.status).toBe(401);
  });
});

describe('cross-site requests', () => {
  it('blocks state-changing requests from an unknown origin but allows the web app', async () => {
    const evil = await supertest(h.app)
      .post('/api/auth/login')
      .set('origin', 'https://evil.example')
      .send({ email: 'x@example.com', password: 'whatever1' });
    expect(evil.status).toBe(403);

    const web = await supertest(h.app)
      .post('/api/auth/login')
      .set('origin', WEB_ORIGIN)
      .send({ email: 'x@example.com', password: 'whatever1' });
    expect(web.status).toBe(401);
    expect(web.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(web.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('auth rate limiting', () => {
  it('limits repeated auth attempts per client', async () => {
    const limited = await startHarnessWithLimit(3);
    try {
      const attempt = () =>
        supertest(limited.app)
          .post('/api/auth/login')
          .send({ email: 'a@example.com', password: 'wrongpass' });
      for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    } finally {
      await limited.jobs.idle();
    }
  });
});

async function startHarnessWithLimit(limit: number) {
  // same database connection; only the app (and its limiter) is new
  const { createApp } = await import('../src/app');
  const { loadApiConfig } = await import('../src/config');
  const config = loadApiConfig({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_RATE_LIMIT: String(limit),
  });
  return { app: createApp({ config, jobs: h.jobs }), jobs: h.jobs };
}
