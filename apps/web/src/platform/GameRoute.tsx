import { findGameBySlug } from '@app/shared';
import { useParams } from 'react-router';
import { GAME_COMPONENTS } from '../games';
import { NotFoundPage } from './NotFoundPage';

/** Resolves `/games/:gameSlug` to the matching game's own entry component. */
export function GameRoute() {
  const { gameSlug } = useParams();
  const game = gameSlug === undefined ? undefined : findGameBySlug(gameSlug);
  if (!game) return <NotFoundPage />;

  const GameComponent = GAME_COMPONENTS[game.id];
  return <GameComponent />;
}
