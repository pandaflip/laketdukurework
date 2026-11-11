# laketdukurework

Rebuild of Laketduku as the first game of a mini-games platform (working brand: RESSA.GAMES).
Development is delivered in validated lots; see `docs/phase-reports/`.

**Current state: Phase 1, lot 1A (technical foundation).** No gameplay, catalog or admin yet.

## Requirements

- Node.js 22.22+ (`.nvmrc`), pnpm 10
- Docker (local PostgreSQL; not used by the code before lot 1B)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
```

- Web app: <http://localhost:5173>
- API health check: <http://localhost:5173/api/health> (proxied to the server on port 3001)

The server refuses to start if a required variable (`WEB_ORIGIN`, `DATABASE_URL`) is missing or invalid.

## Commands

| Command                  | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| `pnpm dev`               | Web (5173) and server (3001) in watch mode         |
| `pnpm check`             | Formatting, lint, type checking and unit tests     |
| `pnpm test`              | Unit and integration tests (Vitest)                |
| `pnpm e2e`               | Browser tests (Playwright); starts the apps itself |
| `pnpm build`             | Production builds (`apps/*/dist`)                  |
| `pnpm format`            | Apply Prettier                                     |
| `pnpm db:up` / `db:down` | Start / stop the local PostgreSQL container        |

First e2e run on a new machine: `pnpm --filter @app/e2e exec playwright install chromium`.

## Layout

```
packages/shared   Pure TypeScript shared by web and server: locales, game and mode
                  registries (technical ids only), API schemas and error codes
apps/server       Fastify API: validated config, security plugins, feature modules
apps/web          React app
  src/platform    Portal shell: layout, language switcher, home, routing to games
  src/games/<id>  One folder per game; a game never imports from another game
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

English is the reference: a test fails if a locale is missing a key or a game/mode entry.
To rename the platform, the game or a mode, edit these files only.
