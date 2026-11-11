import type { ModeId } from './modes';

/**
 * Games hosted by the platform: technical metadata only.
 *
 * The platform, each game and each mode have separate translations
 * (`platform`, `games` and `modes` namespaces). No public name is hardcoded here.
 */
export const GAME_IDS = ['gaming-quiz'] as const;

export type GameId = (typeof GAME_IDS)[number];

export interface GameDefinition {
  readonly id: GameId;
  /** URL segment, e.g. `/games/:slug`. */
  readonly slug: string;
  readonly modeIds: readonly ModeId[];
}

export const GAMES: Readonly<Record<GameId, GameDefinition>> = {
  'gaming-quiz': {
    id: 'gaming-quiz',
    slug: 'gaming-quiz',
    modeIds: ['zoom-out', 'pixelated', 'shadow-guess', 'skin-detective', 'historic', 'chaos-mix'],
  },
};

export function findGameBySlug(slug: string): GameDefinition | undefined {
  return Object.values(GAMES).find((game) => game.slug === slug);
}
