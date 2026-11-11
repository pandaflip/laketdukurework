import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the API is reached through this same-origin proxy, exactly
// like it will be behind the production reverse proxy (HTTPS + WSS).
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
  },
});
