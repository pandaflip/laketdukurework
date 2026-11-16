import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** No 0, 1, I, L, O: a code read aloud or typed on a phone is hard to get wrong. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function newRoomCode(): string {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index++) {
    code += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return code;
}

/** The canonical form of a typed code, or null when it cannot be a code. */
export function normalizeRoomCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** Unguessable identifier: players, frame addresses. */
export const newOpaqueId = (): string => randomBytes(16).toString('hex');

export const newSecret = (): string => randomBytes(32).toString('hex');

/** The server keeps only the hash of a player's secret. */
export const hashSecret = (secret: string): Buffer =>
  createHash('sha256').update(secret, 'utf8').digest();

export function secretMatches(expected: Buffer, secret: string): boolean {
  const actual = hashSecret(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const PLAYER_ID = /^[a-f0-9]{32}$/;
const SECRET = /^[a-f0-9]{64}$/;

/** The cookie value: `<playerId>.<secret>`. Anything else is not an identity. */
export function parseIdentity(
  value: string | undefined,
): { playerId: string; secret: string } | null {
  if (value === undefined) return null;
  const [playerId, secret, extra] = value.split('.');
  if (extra !== undefined || playerId === undefined || secret === undefined) return null;
  return PLAYER_ID.test(playerId) && SECRET.test(secret) ? { playerId, secret } : null;
}

export const formatIdentity = (playerId: string, secret: string): string => `${playerId}.${secret}`;
