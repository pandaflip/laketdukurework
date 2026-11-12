import type { AdminDto } from '@app/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../../db';
import { AppError } from '../../errors';
import { verifyAgainstDummy, verifyPassword } from './password';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;
const LAST_SEEN_REFRESH_MS = 60 * 1000;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Only the hash is stored: a database leak does not expose usable sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const invalidCredentials = (): AppError => new AppError(401, 'INVALID_CREDENTIALS');

export interface LoginResult {
  readonly token: string;
  readonly expiresAt: Date;
  readonly admin: AdminDto;
}

/**
 * Every failure (unknown user, wrong password, disabled or locked account)
 * returns the same error and takes a comparable time.
 */
export async function login(
  db: Db,
  username: string,
  password: string,
  now: Date = new Date(),
): Promise<LoginResult> {
  const admin = await db.adminUser.findUnique({ where: { username: normalizeUsername(username) } });

  const locked = admin?.lockedUntil != null && admin.lockedUntil > now;
  if (!admin || admin.disabledAt !== null || locked) {
    await verifyAgainstDummy(password);
    throw invalidCredentials();
  }

  if (!(await verifyPassword(admin.passwordHash, password))) {
    const failures = admin.failedLoginCount + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await db.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
      },
    });
    throw invalidCredentials();
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.$transaction([
    db.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    }),
    db.adminSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.adminSession.create({
      data: { tokenHash: hashToken(token), adminId: admin.id, expiresAt, lastSeenAt: now },
    }),
  ]);

  return { token, expiresAt, admin: { id: admin.id, username: admin.username } };
}

export async function authenticate(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<AdminDto | null> {
  const session = await db.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { admin: true },
  });
  if (!session) return null;

  const expired = session.expiresAt <= now;
  const idle = now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_MS;
  if (expired || idle || session.admin.disabledAt !== null) {
    await db.adminSession.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    await db.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  return { id: session.admin.id, username: session.admin.username };
}

export async function logout(db: Db, token: string): Promise<void> {
  await db.adminSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}
