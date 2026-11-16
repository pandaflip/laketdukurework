import { defineConfig, devices } from '@playwright/test';

const isCI = process.env.CI !== undefined;

/**
 * Credentials of the administrator created in the throw-away `<name>_e2e`
 * database. They exist only there and are not a secret.
 */
export const E2E_ADMIN = { username: 'e2e-admin', password: 'e2e-only-password-123' };

// Starts the real server and web app. The server command resets and seeds a
// dedicated `<name>_e2e` database derived from DATABASE_URL (.env or environment).
export default defineConfig({
  testDir: './tests',
  // The admin tests share one database: run them one after the other.
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @app/server e2e:serve',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3001',
        LOG_LEVEL: 'warn',
        WEB_ORIGIN: 'http://localhost:5173',
        // Relative to apps/server, ignored by git, emptied by the server at start.
        STORAGE_DIR: './storage/e2e',
        E2E_ADMIN_USERNAME: E2E_ADMIN.username,
        E2E_ADMIN_PASSWORD: E2E_ADMIN.password,
      },
    },
    {
      command: 'pnpm --filter @app/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !isCI,
    },
  ],
});
