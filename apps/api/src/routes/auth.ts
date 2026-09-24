import { AppError, LoginBodySchema, RegisterBodySchema, type UserDto } from '@prepforge/shared';
import { Router } from 'express';
import type { ApiConfig } from '../config';
import { authRateLimit } from '../middleware/security';
import { parseBody } from '../middleware/validate';
import { User } from '../models';
import {
  currentUser,
  endSession,
  hashPassword,
  requireAuth,
  startSession,
  verifyPassword,
} from '../auth/sessions';

const toDto = (user: { _id?: unknown; id?: unknown; email: string; createdAt: Date }): UserDto => ({
  id: String(user.id ?? user._id),
  email: user.email,
  created_at: user.createdAt.toISOString(),
});

export function authRouter(config: ApiConfig): Router {
  const router = Router();
  const limiter = authRateLimit(config.authRateLimit);

  router.post('/register', limiter, async (req, res) => {
    const body = parseBody(RegisterBodySchema, req);
    if (await User.exists({ email: body.email })) {
      throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.', {
        status: 409,
      });
    }
    let user;
    try {
      user = await User.create({
        email: body.email,
        passwordHash: await hashPassword(body.password),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.', {
          status: 409,
        });
      }
      throw error;
    }
    await startSession(res, user._id, config);
    res.status(201).json({ user: toDto(user) });
  });

  router.post('/login', limiter, async (req, res) => {
    const body = parseBody(LoginBodySchema, req);
    const user = await User.findOne({ email: body.email });
    const valid = await verifyPassword(body.password, user?.passwordHash ?? null);
    if (!user || !valid) {
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect email or password.', { status: 401 });
    }
    await startSession(res, user._id, config);
    res.json({ user: toDto(user) });
  });

  router.post('/logout', async (req, res) => {
    await endSession(req, res, config);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    const user = currentUser(req);
    res.json({ user: toDto({ id: user.id, email: user.email, createdAt: user.createdAt }) });
  });

  return router;
}
