import type { GameId } from '@app/shared';
import type { ComponentType } from 'react';
import { GamingQuizHome } from './gaming-quiz/GamingQuizHome';

/**
 * One folder per game under `src/games/`. The platform shell (`src/platform/`)
 * only knows this map: a game never imports from another game.
 */
export const GAME_COMPONENTS: Record<GameId, ComponentType> = {
  'gaming-quiz': GamingQuizHome,
};
