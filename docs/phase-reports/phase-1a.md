# Phase 1 — Lot 1A : socle technique

## Périmètre livré

- Monorepo pnpm : `packages/shared`, `apps/server`, `apps/web`, `e2e`.
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint typé
  (`any` interdit), Prettier, CI GitHub Actions.
- Serveur Fastify : configuration validée au démarrage, en-têtes de sécurité, CORS limité à
  l'origine du site, limitation de débit globale, erreurs réduites à un code stable,
  route `GET /api/health`.
- Application web React + Vite + Tailwind : coquille « plateforme », page d'un jeu, page 404.
- Internationalisation `en` (défaut), `fr`, `pt-BR` : détection du navigateur, sélection
  manuelle, préférence conservée localement, `<html lang>` et titre mis à jour.
- Registres techniques des jeux et des modes, séparés de leurs traductions.
- PostgreSQL local via Docker Compose (non utilisé par le code avant le lot 1B).

## Hors périmètre (lots suivants)

Prisma et le modèle de données, l'authentification admin, le catalogue, l'éditeur de
cadrage, Socket.IO, tout gameplay, les composants shadcn/ui.

## Tests

| Suite                        | Résultat   |
| ---------------------------- | ---------- |
| `packages/shared` (Vitest)   | 10 réussis |
| `apps/server` (Vitest)       | 13 réussis |
| `apps/web` (Vitest + jsdom)  | 17 réussis |
| `e2e` (Playwright, Chromium) | 4 réussis  |

## Limites connues

- `docker-compose.yml` n'a pas pu être exécuté dans l'environnement de développement
  (pas de démon Docker) : à vérifier sur un poste local.
- `GET /api/health` ne teste pas la base de données (ajout au lot 1B).
- TypeScript est fixé en 6.0 : `typescript-eslint` ne prend pas encore en charge la 7.
- Les traductions `pt-BR` n'ont pas été relues par un locuteur natif.
