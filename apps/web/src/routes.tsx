import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { AppLayout } from './platform/AppLayout';
import { GameRoute } from './platform/GameRoute';
import { HomePage } from './platform/HomePage';
import { NotFoundPage } from './platform/NotFoundPage';

// The administration area is a separate chunk: players never download it.
const AdminApp = lazy(() => import('./admin/AdminApp'));

/** Future route: `/room/:roomCode` (Phase 2). */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'games/:gameSlug', element: <GameRoute /> },
      {
        path: 'admin/*',
        element: (
          <Suspense fallback={null}>
            <AdminApp />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
