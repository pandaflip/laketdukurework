import type { CommandRejection, AnswerOutcome, VoteOutcome } from './outcomes';
import type { PrivateView, PublicView } from './views';

/**
 * What the server sends over the WebSocket of a room. Every message is JSON
 * with a `type`. The state messages carry the two views of `views.ts`: the
 * answer of a round never appears before its reveal.
 */
export type ServerMessage =
  | {
      readonly type: 'welcome';
      readonly roomCode: string;
      readonly playerId: string;
      /** What the player may type (names only), in their language. */
      readonly suggestions: readonly string[];
    }
  | { readonly type: 'state'; readonly public: PublicView; readonly private: PrivateView }
  | { readonly type: 'answerResult'; readonly result: AnswerOutcome }
  | { readonly type: 'voteResult'; readonly result: VoteOutcome }
  | {
      readonly type: 'commandResult';
      readonly command: 'configure' | 'start';
      readonly ok: boolean;
      readonly reason?: CommandRejection;
    }
  /** Number of challenges the host's filters leave, sent to the host in the lobby. */
  | { readonly type: 'pool'; readonly size: number }
  | { readonly type: 'error'; readonly code: ProtocolErrorCode }
  | { readonly type: 'closing'; readonly reason: ClosingReason };

export type ProtocolErrorCode = 'RATE_LIMITED' | 'INVALID_MESSAGE' | 'UNSUPPORTED';

export type ClosingReason = 'REPLACED' | 'ROOM_CLOSED' | 'SERVER_STOPPING' | 'ABUSE' | 'LEFT';

/** WebSocket close codes used by the server. */
export const CLOSE_CODES = {
  normal: 1000,
  goingAway: 1001,
  policy: 1008,
  tryAgainLater: 1013,
  /** Another connection of the same player took over. */
  replaced: 4001,
} as const;
