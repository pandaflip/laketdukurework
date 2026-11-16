import { FIRST_PLACE_POINTS, MIN_RANK_POINTS, RANK_DECAY } from './limits';

/**
 * Points for the player who finds the answer in `rank`th position (1 is the
 * first). The first finder earns 1000, then 800, 640, 512, 410, 328, 262, 210:
 * every rank earns 20% less than the previous one. Independent of the number
 * of players, of the time and of the step.
 */
export function rankPoints(rank: number): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  return Math.max(MIN_RANK_POINTS, Math.round(FIRST_PLACE_POINTS * RANK_DECAY ** (rank - 1)));
}

export interface Totals {
  readonly playerId: string;
  readonly score: number;
  /** Rounds in which the player found the answer first. */
  readonly firsts: number;
  /** Rounds in which the player found the answer. */
  readonly found: number;
  /** Order of arrival in the room: the last, arbitrary, tie breaker for display. */
  readonly joinOrder: number;
}

export interface Placed extends Totals {
  /** 1 for the leader; players equal on every criterion share a place. */
  readonly place: number;
}

/**
 * Deterministic ranking: score, then rounds won first, then rounds found.
 * Players equal on all three share a place (and are listed by arrival order).
 */
export function rankStandings(totals: readonly Totals[]): Placed[] {
  const sorted = [...totals].sort(
    (a, b) =>
      b.score - a.score || b.firsts - a.firsts || b.found - a.found || a.joinOrder - b.joinOrder,
  );
  const placed: Placed[] = [];
  sorted.forEach((entry, index) => {
    const previous = placed[index - 1];
    const tied =
      previous !== undefined &&
      previous.score === entry.score &&
      previous.firsts === entry.firsts &&
      previous.found === entry.found;
    placed.push({ ...entry, place: tied ? previous.place : index + 1 });
  });
  return placed;
}

/**
 * The players sharing the first place (several when the tie persists among
 * players who scored). Nobody wins a game in which nobody scored.
 */
export function winnersOf(totals: readonly Totals[]): string[] {
  return rankStandings(totals)
    .filter((entry) => entry.place === 1 && entry.score > 0)
    .map((entry) => entry.playerId);
}
