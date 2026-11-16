import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { initI18n } from './i18n';
import { ApiError } from './lib/api';
import { routes } from './routes';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing');

await initI18n();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5_000,
      // A refusal from the server (not found, not signed in...) will not change on a retry:
      // only network trouble and server errors are worth trying again.
      retry: (failures, error) =>
        failures < 2 &&
        (!(error instanceof ApiError) ||
          error.code === 'NETWORK_ERROR' ||
          error.code === 'INTERNAL_ERROR' ||
          error.code === 'SERVICE_UNAVAILABLE'),
    },
  },
});

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createBrowserRouter(routes)} />
    </QueryClientProvider>
  </StrictMode>,
);
