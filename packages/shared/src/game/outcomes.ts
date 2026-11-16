export type AnswerRejection =
  | 'NOT_IN_ROUND'
  | 'UNKNOWN_PLAYER'
  | 'NOT_CONNECTED'
  | 'ALREADY_FOUND'
  | 'STALE_STEP'
  | 'INVALID_ANSWER'
  | 'RATE_LIMITED'
  | 'COOLDOWN'
  | 'STEP_ATTEMPT_USED'
  | 'NO_ATTEMPTS_LEFT'
  | 'TECHNICAL_CAP';

export type AnswerOutcome =
  | { readonly status: 'correct'; readonly rank: number; readonly points: number }
  | { readonly status: 'wrong' }
  | {
      readonly status: 'rejected';
      readonly reason: AnswerRejection;
      /** Milliseconds before the same answer could be accepted, when waiting helps. */
      readonly retryAfterMs?: number;
    };

export type VoteRejection =
  | 'NOT_IN_ROUND'
  | 'UNKNOWN_PLAYER'
  | 'NOT_CONNECTED'
  | 'VOTES_DISABLED'
  | 'STALE_STEP'
  | 'LAST_STEP'
  | 'NOT_ELIGIBLE';

export type VoteOutcome =
  | { readonly status: 'counted' | 'already' }
  | { readonly status: 'rejected'; readonly reason: VoteRejection };

export type CommandRejection = 'NOT_HOST' | 'WRONG_PHASE' | 'INVALID' | 'POOL_TOO_SMALL';

export type CommandResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: CommandRejection };
