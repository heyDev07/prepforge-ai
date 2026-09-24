/**
 * Password hashing (bcrypt) and server-side sessions.
 *
 * The browser holds an opaque random token in an HttpOnly cookie; the database stores only its
 * sha256 hash, so a leaked database cannot be replayed as sessions. Logout deletes the session.
 */
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '@prepforge/shared';
import bcrypt from 'bcryptjs';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import type { Types } from 'mongoose';
import type { ApiConfig } from '../config';
import { Session, User } from '../models';

export const SESSION_COOKIE = 'pf_session';
const BCRYPT_COST = 12;
/** Compared against when the email is unknown, so both paths take the same time. */
const DUMMY_HASH = bcrypt.hashSync('prepforge-timing-equaliser', BCRYPT_COST);

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  const matches = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash !== null && matches;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function cookieOptions(config: ApiConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlMs,
  };
}

export async function startSession(res: Response, userId: Types.ObjectId, config: ApiConfig) {
  const token = randomBytes(32).toString('base64url');
  await Session.create({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + config.sessionTtlMs),
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(config));
}

export async function endSession(req: Request, res: Response, config: ApiConfig) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token) await Session.deleteOne({ tokenHash: hashToken(token) });
  const { maxAge: _maxAge, ...clearOptions } = cookieOptions(config);
  res.clearCookie(SESSION_COOKIE, clearOptions);
}

export interface AuthedUser {
  id: Types.ObjectId;
  email: string;
  createdAt: Date;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

/** Loads the user for a valid session cookie; otherwise 401. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || !token) {
    return next(new AppError('UNAUTHORIZED', 'Please sign in.', { status: 401 }));
  }
  const session = await Session.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  }).lean();
  const user = session ? await User.findById(session.userId).lean() : null;
  if (!user) return next(new AppError('UNAUTHORIZED', 'Please sign in.', { status: 401 }));
  req.user = { id: user._id, email: user.email, createdAt: user.createdAt };
  next();
}

export function currentUser(req: Request): AuthedUser {
  if (!req.user) throw new AppError('UNAUTHORIZED', 'Please sign in.', { status: 401 });
  return req.user;
}
