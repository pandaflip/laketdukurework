# Phase 2 — Sous-lot 2B-1 : salons et réseau

## Périmètre livré

La couche réseau au-dessus du moteur 2A, sans écran (2C) ni catégories (2B-2). Spécification :
`docs/jeu-reseau.md`.

- **Salons privés** en mémoire : code de 6 caractères, 1 à 8 joueurs, hôte, nettoyage des salons
  vides, terminés ou inactifs, plafonds en tout et par adresse IP, tous réglables par variables
  d'environnement.
- **Identité par cookie** `HttpOnly`, `SameSite=Strict`, `Secure` en production, dont le chemin est
  celui du salon ; secret de 256 bits dont le serveur ne garde que l'empreinte ; contrôle d'`Origin`.
- **WebSocket** (`@fastify/websocket`) : authentification avant la mise à niveau, une connexion par
  joueur (la plus récente remplace l'ancienne), messages strictement validés et plafonnés, débit
  limité par connexion, coupure des abus et des clients lents, battement de cœur, avertissement à
  l'arrêt du serveur.
- **Reconnexion** : 5 s de grâce avant de signaler l'absence ; identité, score, statut, tentatives et
  vote conservés ; salon d'attente libéré après 60 s d'absence.
- **Images** : route `/api/play/rooms/:code/frames/:token` qui authentifie le joueur, vérifie son
  appartenance au salon et que l'étape est révélée ; 404 uniforme sinon.
- **Configuration de l'hôte** et lancement par messages, avec le nombre de défis disponibles.
- **Commande de mesure** `pnpm bench:render` pour vos splash arts, plusieurs salons à la fois.

Hors périmètre, non réalisé : écrans, catégories (modèle et administration), import des
catégories, relèvement des limites d'import.

## Fichiers principaux

| Zone                        | Fichiers                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/server/src/play/`     | `codes`, `rate`, `room`, `manager`, `routes` (+ `room.test.ts`)                                   |
| `apps/server/src/cli/`      | `bench-render.ts`, `bench-lib.ts`, `bench.test.ts`                                                |
| `apps/server/test/`         | `play.int.test.ts`, `play-helpers.ts` (horloge manuelle, client WebSocket)                        |
| `packages/shared/src/game/` | `protocol.ts`, `outcomes.ts`, messages `configure` / `start` / `leave`                            |
| Modifiés                    | `app.ts`, `config.ts`, `match.ts` (types déplacés vers le paquet partagé), erreurs et traductions |

Dépendances ajoutées : `@fastify/websocket` (serveur), `ws` et `@types/ws` (tests). Aucune migration.

## Tests

| Suite                                                | Résultat        |
| ---------------------------------------------------- | --------------- |
| `packages/shared`                                    | 151 (146 avant) |
| `apps/server` (PostgreSQL, Sharp et sockets réels)   | 323 (290 avant) |
| `apps/web`                                           | 23              |
| Playwright (aucune régression)                       | 27              |
| Build de production ; serveur compilé essayé en réel | Vérifiés        |

Les tests réseau (`play.int.test.ts`, 23 scénarios) font tourner un vrai serveur et de vrais sockets,
avec une **horloge de jeu manuelle** (le décompte de 3 s et la révélation de 8 s ne ralentissent pas
les tests) : création et arrivée (origine, pseudos, salon complet, partie commencée), identités
falsifiées ou d'un autre salon, deux onglets, droits d'hôte usurpés, messages trop gros, mal formés,
trop nombreux, client lent, partie complète de bout en bout (images, réponses, révélation,
vainqueur), reconnexion avec conservation, **isolation entre deux salons** (images et commandes),
salle d'attente, plafonds, nettoyage et arrêt du serveur.

Contrôles faits exprès : six règles ont été cassées volontairement (secret non vérifié ; image servie
sans appartenance ; origine du WebSocket non contrôlée ; ancienne connexion remplacée encore
autorisée ; délai de grâce ignoré ; plafond par adresse ignoré) ; les tests échouent bien à chaque fois.

## Décisions prises en cours de route

- **Le cookie a pour chemin le salon** : les identités de plusieurs salons ouverts ne se mélangent
  jamais, et le serveur choisit l'identité d'après le salon demandé.
- **Le `welcome` précède toujours le premier `state`** (testé).
- **Les limites par minute** (création, arrivée, connexion) sont aussi réglables.
- **Arrêt du serveur** : le plugin WebSocket coupe les connexions avant tout hook ordinaire ; sa
  fermeture est donc personnalisée pour prévenir les joueurs d'abord.

## Limites connues

- Salons en mémoire, une seule instance ; l'ordre des réponses dépend de la latence.
- Un salon dont on connaît le code peut être rempli par des inconnus dans le salon d'attente.
- Mesure de mémoire et de temps de rendu à faire avec vos images : voir `docs/jeu-reseau.md`
  (« Mesurer la mémoire et le temps de rendu avec vos images »). Les limites d'import ne sont pas
  relevées avant son analyse.
