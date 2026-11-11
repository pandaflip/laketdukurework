import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { initI18n } from './i18n';
import { routes } from './routes';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing');

await initI18n();

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
  </StrictMode>,
);
