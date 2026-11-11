# laketdukurework

Rebuild of Laketduku as the first game of a mini-games platform (working brand: RESSA.GAMES).
Development is delivered in validated lots; see `docs/phase-reports/`.

**Current state: Phase 1, lots 1A and 1B.** Technical foundation, administrable catalog,
safety policy and administration area. No image upload (lot 1C) and no gameplay (Phase 2) yet.

## Requirements

- Node.js 22.22+ (`.nvmrc`), pnpm 10
- Docker (local PostgreSQL)

## First-time setup

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm admin:create
pnpm dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

- `pnpm db:migrate` applies the database migrations (safe to re-run).
- `pnpm db:seed` adds a small demonstration catalog (optional, safe to re-run). Every seeded
  character is Restricted and nobody is a verified adult.
- `pnpm admin:create` asks for a username and a password (12 characters minimum, typed hidden).
  Use `pnpm --filter @app/server admin:create --reset` to change a password.

Then open:

- Web app: <http://localhost:5173>
- Administration: <http://localhost:5173/admin>
- API health check: <http://localhost:5173/api/health> (proxied to the server on port 3001)

The server refuses to start if a required variable (`WEB_ORIGIN`, `DATABASE_URL`) is missing or
invalid.

## Commands

| Command                  | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `pnpm dev`               | Web (5173) and server (3001) in watch mode                     |
| `pnpm check`             | Formatting, lint, type checking and tests (needs PostgreSQL)   |
| `pnpm test`              | Unit and integration tests (Vitest)                            |
| `pnpm e2e`               | Browser tests (Playwright); starts the apps itself             |
| `pnpm build`             | Production builds (`apps/*/dist`)                              |
| `pnpm format`            | Apply Prettier                                                 |
| `pnpm db:up` / `db:down` | Start / stop the local PostgreSQL container                    |
| `pnpm db:migrate`        | Apply pending migrations                                       |
| `pnpm db:migrate:dev`    | Create a migration after editing `schema.prisma` (development) |
| `pnpm db:seed`           | Add the demonstration catalog                                  |
| `pnpm admin:create`      | Create an administrator                                        |

Tests never touch development data: they create and use separate databases derived from
`DATABASE_URL` (`<name>_test` for Vitest, `<name>_e2e` for Playwright).

First e2e run on a new machine: `pnpm --filter @app/e2e exec playwright install chromium`.

## Safety policy

See `docs/content-policy.md`. In short: the administrable status (Allowed / Restricted /
Excluded) never opens a sensitive mode on its own. The server computes eligibility from the
status, the safety classification, the universe settings, per-mode restrictions, per-image
approval and fundamental exclusions written in code
(`packages/shared/src/policy/`).

## Layout

```
packages/shared   Pure TypeScript shared by web and server: locales, game and mode
                  registries (technical ids only), API schemas, error codes and the
                  eligibility policy
apps/server       Fastify API: validated config, security plugins, feature modules
  prisma          Database schema and migrations
  src/modules     auth, catalog, audit (history), health
  src/cli         Seed and administrator creation
apps/web          React app
  src/platform    Portal shell: layout, language switcher, home, routing to games
  src/games/<id>  One folder per game; a game never imports from another game
  src/admin       Administration area (separate chunk, loaded on /admin only)
  src/design      Design tokens (provisional values) and shared components
  src/i18n        i18next setup and translation files (en, fr, pt-BR)
e2e               Playwright tests
```

## Naming and translations

No brand, game or mode name is hardcoded in components. Technical identifiers
(`gaming-quiz`, `zoom-out`, `historic`, ...) are stable and language-independent; display
names and descriptions live in `apps/web/src/i18n/locales/<locale>/`:

| File            | Content                           |
| --------------- | --------------------------------- |
| `platform.json` | Portal name and tagline           |
| `games.json`    | Name and description of each game |
| `modes.json`    | Name and description of each mode |
| `common.json`   | Interface strings                 |
| `errors.json`   | Messages for API error codes      |
| `admin.json`    | Administration area               |

English is the reference: a test fails if a locale is missing a key or a game/mode entry.
To rename the platform, the game or a mode, edit these files only.
