# Phase 2 — Sous-lot 2A : moteur de jeu Zoom Out

## Périmètre livré

Le moteur, sans écran ni salon réseau (2B et 2C). Spécification complète : `docs/jeu-zoom-out.md`.

- **Machine d'états** d'une partie (`apps/server/src/game/match.ts`) : salon d'attente, décompte,
  manches, révélation, fin ; sans horloge, socket ni base de données (l'heure est un paramètre).
- **Exécuteur** (`runtime.ts`) : programme les échéances et prépare la manche suivante pendant la
  révélation de la précédente ; il n'ajoute aucune règle.
- **Contrats partagés** (`packages/shared/src/game/`) : configuration de l'hôte validée, vues
  publique et privée, messages client, scoring, classement, filtres, sélection des étapes.
- **Scoring** par ordre des réponses : `round(1000 × 0,8^(rang − 1))`, classement déterministe.
- **Tentatives** (illimitées avec délai, une par étape, limitées), **vote pour dézoomer**
  (50 % / 75 % / unanimité), sous-échantillonnage des étapes, durée de manche dérivée.
- **Réponses** : normalisation, noms de trois langues, alias séparés, tolérance aux fautes,
  refus des ambiguïtés, autocomplétion indépendante du tirage.
- **Sélection** (`pool.ts`, `candidates.ts`) : images approuvées et éligibles, sans doublon de
  personnage, réévaluées depuis la base juste avant chaque manche.
- **Rendu sécurisé** (`clues/zoom-out.ts`) : découpe de l'original, jetons d'adresse créés à la
  révélation, image entière seulement après la manche.
- **Modularité** : `ClueSource`, `AnswerKey` et `PlayProfile` isolent ce qui change d'un mode ou
  d'un profil (solo classique, solo chronométré) à l'autre ; le moteur ne dépend d'aucun.

Hors périmètre, non réalisé : écrans, WebSocket, salons, catégories (tables et administration),
modes autres que Zoom Out, solo, comptes, classements persistants.

## Fichiers principaux

| Zone                        | Fichiers                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `packages/shared/src/game/` | `config`, `limits`, `scoring`, `steps`, `filters`, `messages`, `views`, `game.test`    |
| `apps/server/src/game/`     | `match`, `runtime`, `answers`, `pool`, `candidates`, `deck`, `types`, `clues/zoom-out` |
| `apps/server/test/`         | `game.int.test.ts` (PostgreSQL et Sharp réels)                                         |
| Modifiés                    | `characters.service.ts` (type d'entrée de `eligibilityInputs`), `storage.ts` (`read`)  |
| Documentation               | `docs/jeu-zoom-out.md`, `docs/images-et-sequences.md` (limites futures, stockage)      |

Dépendance ajoutée : `fast-check` (développement, serveur), déjà utilisée par le paquet partagé.
Aucune migration, aucune table.

## Tests

| Suite                                                                   | Résultat        |
| ----------------------------------------------------------------------- | --------------- |
| `packages/shared` (dont propriétés : étapes, classement)                | 146 (122 avant) |
| `apps/server` (moteur, réponses, exécuteur, intégration sur PostgreSQL) | 275 (182 avant) |
| `apps/web`                                                              | 23              |
| Playwright (aucune régression)                                          | 27              |
| Build de production                                                     | Vérifié         |

Contrôles faits exprès : cinq règles ont été cassées volontairement (pas de réévaluation avant la
manche ; réponse proche de la bonne affichée ; vote d'une étape passée accepté ; quotas remis à
zéro à la reconnexion ; pas de garde contre les noms voisins) ; les tests échouent bien à chaque fois.

Les tests de **concurrence** vérifient que huit réponses simultanées reçoivent huit rangs distincts
dans l'ordre de traitement et que des votes en double ne comptent qu'une fois. Les tests de
**non-fuite** parcourent toutes les vues, les vues privées et les événements d'une manche à la
recherche du nom, de l'univers et de l'image avant la révélation.

## Décisions prises en cours de route

- **Personne n'a marqué** (30 manches ou plus de défis) : la partie se termine sans vainqueur.
- **Réponse affichée** : une mauvaise réponse n'est publiée que si elle ne nomme, n'abrège ni ne
  déforme la bonne ; sinon seul son auteur la voit (sinon, avec les alias désactivés, taper « LB »
  aurait révélé la réponse à tous).
- **Rejoindre une salle** : seulement dans le salon d'attente.
- **Éligibilité** : un mode neutre n'accepte que `APPROVED_NEUTRAL` (décision de la relecture) ; une approbation sensible ne vaut pas approbation neutre.
- **Catégories** : le filtre est défini et testé, mais les tables arrivent en 2B ; en attendant,
  un filtre par catégorie ne retient rien.

## Corrections de la relecture

- Zoom Out n'accepte que `APPROVED_NEUTRAL` (règle générale des modes neutres dans
  `challengeEligibility`) ; quatre tests du lot 1B qui supposaient l'inverse ont été mis à jour, et
  une propriété vérifie qu'une approbation sensible n'ouvre jamais un mode neutre.
- Personne n'a marqué : la partie se termine sans vainqueur ; l'égalité entre joueurs ayant marqué
  reste partagée.
- Les réponses et votes d'un joueur déconnecté sont refusés par le moteur (`NOT_CONNECTED`), en
  plus du contrôle de la connexion que fera la couche réseau en 2B (le moteur ne peut pas
  authentifier : il reçoit l'identité d'une connexion déjà authentifiée).
- La reconnexion d'un joueur inscrit rend sa place, son score, son statut, ses tentatives et son
  vote ; personne ne peut rejoindre après le lancement.
- Mémoire : le dernier rendu est libéré à la fin de la partie, l'original lu n'est plus gardé
  une fois toutes les frames rendues (tests : une seule lecture par manche, rendu une frame à la
  fois, plus rien de servi après libération). Mesures : voir `docs/jeu-zoom-out.md`.

## Limites connues

- Salons en mémoire, une seule instance ; un redémarrage perd les parties.
- L'ordre des réponses dépend de la latence ; pas de compensation du ping.
- Le rendu de l'original coûte du processeur (mesure à faire sur vos splash arts en 2B, avec
  plusieurs joueurs) ; la concurrence est plafonnée par `IMAGE_CONCURRENCY`.
