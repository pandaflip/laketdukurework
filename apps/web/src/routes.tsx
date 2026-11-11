import type { RouteObject } from 'react-router';
import { AppLayout } from './platform/AppLayout';
import { GameRoute } from './platform/GameRoute';
import { HomePage } from './platform/HomePage';
import { NotFoundPage } from './platform/NotFoundPage';

/** Future routes: `/room/:roomCode` (Phase 2) and `/admin` (lot 1B). */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'games/:gameSlug', element: <GameRoute /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
