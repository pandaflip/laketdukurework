import type { AttemptsConfig, RoomConfig } from './config';
import type { LocalizedNames } from '../catalog/schemas';

/**
 * What the server sends to players. Two kinds of view, always built apart:
 *
 *  - the PUBLIC view is the same for everyone in the room;
 *  - the PRIVATE view concerns one player (their attempts, their vote).
 *
 * Neither contains the answer, an identifier of the character or of the image,
 * or an address of a frame that has not been revealed yet. The answer only
 * appears in `reveal`, once the round is over.
 */

export const MATCH_PHASES = [
  'lobby',
  'awaitingChallenge',
  'countdown',
  'round',
  'reveal',
  'finished',
] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export interface PublicPlayer {
  readonly id: string;
  readonly nickname: string;
  readonly connected: boolean;
  readonly isHost: boolean;
  readonly score: number;
  readonly place: number;
  /** Whether this player has found the answer of the current round. */
  readonly found: boolean;
  /** Rank among the players who found it (1 is the first), once found. */
  readonly foundRank: number | null;
  readonly foundPoints: number | null;
}

export interface PublicRound {
  readonly number: number;
  /** Index of the step on screen (0 is the most zoomed) and the real number of steps. */
  readonly stepIndex: number;
  readonly stepCount: number;
  /** Opaque address of the step on screen; only revealed steps have one. */
  readonly frameToken: string;
  /** Server time (ms) at which the next step appears; null on the last step. */
  readonly nextStepAt: number | null;
  /** Server time (ms) at which the round ends if nobody answers. */
  readonly endsAt: number;
  readonly votes: { readonly count: number; readonly needed: number } | null;
  /** Wrong answers of everyone, only when the host chose to show them. */
  readonly wrongAnswers: readonly { readonly playerId: string; readonly text: string }[] | null;
}

export interface PublicReveal {
  readonly names: LocalizedNames;
  readonly universe: string;
  /** Address of the whole picture, available once the round is over. */
  readonly frameToken: string;
  readonly finders: readonly {
    readonly playerId: string;
    readonly rank: number;
    readonly points: number;
  }[];
}

export interface PublicView {
  /** Increases at every change: a client can drop stale or duplicated updates. */
  readonly version: number;
  /** Server time (ms) when the view was built, to compute the clock offset. */
  readonly serverNow: number;
  readonly phase: MatchPhase;
  readonly config: RoomConfig;
  readonly hostId: string;
  readonly players: readonly PublicPlayer[];
  readonly roundsPlayed: number;
  readonly countdownEndsAt: number | null;
  readonly round: PublicRound | null;
  readonly reveal: PublicReveal | null;
  readonly revealEndsAt: number | null;
  readonly winners: readonly string[] | null;
}

export type AnswerBlock =
  | 'NOT_IN_ROUND'
  | 'ALREADY_FOUND'
  | 'COOLDOWN'
  | 'STEP_ATTEMPT_USED'
  | 'NO_ATTEMPTS_LEFT'
  | 'TECHNICAL_CAP';

export interface PrivateView {
  readonly playerId: string;
  readonly isHost: boolean;
  readonly attempts: AttemptsConfig | null;
  readonly attemptsUsed: number;
  /** Answers left, when the mode counts them (per step or per round). */
  readonly attemptsLeft: number | null;
  /** Server time (ms) before which the next answer is refused (unlimited mode). */
  readonly nextAnswerAt: number | null;
  readonly blocked: AnswerBlock | null;
  readonly voted: boolean;
  readonly canVote: boolean;
  /** The player's own wrong answers in this round (always visible to them). */
  readonly myWrongAnswers: readonly string[];
}
