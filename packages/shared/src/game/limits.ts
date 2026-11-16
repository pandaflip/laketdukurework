/**
 * Fixed rules of a game, shared by the engine, the network layer and the
 * interface. They are constants on purpose: only the options in `RoomConfig`
 * are chosen by the host.
 */

/** Rooms hold one to eight players (a solo game is a room of one). */
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;

/** A game needs at least this many eligible challenges to start. */
export const MIN_POOL_SIZE = 5;
/** Safety net: a game never lasts more rounds than this. */
export const MAX_ROUNDS = 30;

export const COUNTDOWN_MS = 3_000;
export const REVEAL_MS = 8_000;
/** The last step stays on screen for `max(delay, FINAL_HOLD_MIN_SEC)` seconds. */
export const FINAL_HOLD_MIN_SEC = 8;
/** Two steps are never shown less than this far apart, whatever the votes say. */
export const MIN_STEP_GAP_MS = 1_500;

export const MAX_ANSWER_LENGTH = 40;
/** Least time between two answers of one player, in every attempts mode. */
export const MIN_ANSWER_GAP_MS = 400;
/** Hard ceiling on the answers one player may submit in one round, in every mode. */
export const MAX_ATTEMPTS_PER_ROUND = 100;

/** Answer tolerance: names shorter than this are always compared exactly. */
export const TYPO_MIN_LENGTH = 5;
/** From this length on, two typing mistakes are tolerated instead of one. */
export const TYPO_TWO_ERRORS_LENGTH = 10;

/** Points of the first player to find; each rank after earns 20% less. */
export const FIRST_PLACE_POINTS = 1_000;
export const RANK_DECAY = 0.8;
export const MIN_RANK_POINTS = 100;
