import { z } from 'zod';
import { MAX_ANSWER_LENGTH, NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from './limits';

/**
 * Messages a player may send during a game. Strictly validated: unknown
 * fields, wrong types and oversized text are refused before the engine sees
 * them. No message carries a score, a rank, a player identifier or a host
 * flag: who sends it comes from the connection, never from the content.
 */
export const answerMessageSchema = z.strictObject({
  type: z.literal('answer'),
  /** The step the player was looking at: an answer for a past step is refused. */
  stepIndex: z.number().int().min(0).max(99),
  text: z.string().max(MAX_ANSWER_LENGTH * 4),
});

export const voteMessageSchema = z.strictObject({
  type: z.literal('vote'),
  stepIndex: z.number().int().min(0).max(99),
});

/** Host only, lobby only: a whole or partial configuration, validated by the engine. */
export const configureMessageSchema = z.strictObject({
  type: z.literal('configure'),
  config: z.record(z.string().max(32), z.unknown()),
});

export const startMessageSchema = z.strictObject({ type: z.literal('start') });
export const leaveMessageSchema = z.strictObject({ type: z.literal('leave') });

export const clientMessageSchema = z.discriminatedUnion('type', [
  answerMessageSchema,
  voteMessageSchema,
  configureMessageSchema,
  startMessageSchema,
  leaveMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** A nickname: trimmed, 2 to 16 characters, no control or invisible characters. */
export function cleanNickname(value: string): string | null {
  const trimmed = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(trimmed)) {
    return null;
  }
  const length = Array.from(trimmed).length;
  return length >= NICKNAME_MIN_LENGTH && length <= NICKNAME_MAX_LENGTH ? trimmed : null;
}
