# Phase 1 — Lot 1B : catalogue, restrictions et administration

## Périmètre livré

- **Base de données** : schéma Prisma et première migration (univers, personnages, noms et
  alias localisés, variantes, modes bloqués, revue des images, administrateurs, sessions,
  historique).
- **Politique de sécurité** : fonction d'éligibilité unique et pure dans `packages/shared`,
  exclusions fondamentales en code, tests de propriété.
- **API d'administration** : authentification, univers, personnages, variantes, statuts
  individuels et groupés, classification, modes bloqués, historique et restauration.
- **Interface d'administration** (`/admin`) en anglais, français et portugais brésilien.
- **Design** : tokens centralisés à valeurs provisoires, composants partagés, migration des
  écrans existants.
- **Infrastructure** : health check avec état de la base, CI limitée à `main` pour `push`,
  service PostgreSQL en CI.

## Hors périmètre

Upload d'images, éditeur de cadrage et génération Sharp (lot 1C). Salons, manches et scores
(Phase 2). L'approbation individuelle des images est préparée (modèle `Asset`, règle
d'éligibilité testée) mais aucune image ne peut encore être importée.

## Tests

| Suite                                               | Résultat   |
| --------------------------------------------------- | ---------- |
| `packages/shared` (Vitest, dont tests de propriété) | 42 réussis |
| `apps/server` (Vitest, PostgreSQL réel)             | 63 réussis |
| `apps/web` (Vitest + jsdom)                         | 20 réussis |
| `e2e` (Playwright, Chromium)                        | 8 réussis  |

## Décisions techniques

- **Deux axes indépendants** : statut administrable et classification de sécurité.
- **« Désactiver » un personnage** correspond au statut `EXCLUDED` ; il n'y a pas de
  suppression.
- **Modes par univers** : une liste de modes activés par univers ; un nouvel univers démarre
  avec les modes neutres uniquement.
- **Restauration contrôlée** : elle rejoue l'ancienne valeur par les services normaux, refuse
  d'écraser un changement plus récent et ne peut jamais attribuer `ADULT_VERIFIED`.
- **Composants d'interface maison** construits sur les tokens, à la place de shadcn/ui.
- **Sessions** : jeton aléatoire en cookie `HttpOnly` `SameSite=Strict`, seul son hachage est
  en base ; 12 h maximum, 2 h d'inactivité.
- **Connexion** : argon2id, verrouillage de 15 minutes après 5 échecs, limite par adresse IP,
  réponse identique quel que soit le motif d'échec.

## Limites connues

- La gestion des comptes administrateurs se fait en ligne de commande uniquement.
- Le verrouillage de compte peut être déclenché par un tiers qui connaît l'identifiant ; il
  est temporaire et s'ajoute à la limite par adresse IP.
- Les limites de débit sont en mémoire : elles repartent de zéro au redémarrage du serveur.
- La création et la suppression de variantes, ainsi que la création de personnages et
  d'univers, sont journalisées mais non restaurables.
- Un avertissement de dépréciation de la bibliothèque `pg`, émis par l'adaptateur Prisma,
  apparaît dans les journaux ; il est sans effet aujourd'hui.
- Les en-têtes de sécurité des pages web (CSP du site) seront posés au déploiement.
- Les traductions `pt-BR` n'ont pas été relues par un locuteur natif.
