import { defineConfig } from 'prisma/config';

// The Prisma CLI does not load `.env` by itself: read the repository one if present.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // No .env file: rely on real environment variables (CI, production).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
