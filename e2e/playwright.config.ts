import { defineConfig, devices } from '@playwright/test';

const isCI = process.env.CI !== undefined;

// Starts the real server and web app. The database is not used yet (lot 1A),
// but the server requires a well-formed DATABASE_URL to boot.
export default defineConfig({
  testDir: './tests',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @app/server dev',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: !isCI,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3001',
        LOG_LEVEL: 'warn',
        WEB_ORIGIN: 'http://localhost:5173',
        DATABASE_URL: 'postgresql://e2e:e2e@127.0.0.1:5432/e2e',
      },
    },
    {
      command: 'pnpm --filter @app/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !isCI,
    },
  ],
});
