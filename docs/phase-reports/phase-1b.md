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

## Révision après la validation fonctionnelle

Ajustements demandés après les tests du client, appliqués sur la même PR.

### Politique des univers

- L'interdiction définitive fondée sur le nom (Pokémon, Minecraft) est remplacée par un niveau
  d'audience `YOUTH` : sensibles **verrouillés par défaut**, déverrouillage explicite par univers
  (confirmation, justification de 60 caractères, journalisé, jamais restaurable), reverrouillage
  immédiat qui coupe les modes sensibles. Détail et protections non configurables dans
  `docs/content-policy.md`.
- Le déverrouillage ne lève aucune autre condition : adulte vérifié, statut `ALLOWED`, mode
  activé, absence d'exclusion fondamentale et image approuvée restent exigés. Un adulte vérifié
  dans un univers `YOUTH` demande aussi la justification de 60 caractères.
- Chaos Mix est déclaré **composite** : jamais éligible en tant que tel, chaque manche est
  vérifiée sous son mode réel et pour l'image utilisée (`assertRoundEligible`).

### Ergonomie du catalogue

- Tableau : deux badges d'éligibilité (neutre / sensible) et un badge d'images en contour, pour
  distinguer l'éligibilité du personnage de l'approbation de ses images. Les motifs détaillés
  sont dans la fiche (section « Éligibilité effective », atteinte par le lien « Pourquoi ? »).
  Légende repliable sous les filtres. Pagination serveur (testée avec 300 personnages).
- Fiche : éligibilité mode par mode avec motifs et nombre d'images utilisables, carte des images.

### Historique

Tests ajoutés : une restauration est journalisée et liée à l'entrée d'origine ; elle peut être
annulée, plusieurs fois de suite, et une restauration de lot est elle-même un lot restaurable ;
une ancienne restauration est refusée dès qu'un changement plus récent existe (noms, modes
bloqués, classification, univers) ; les validations de sécurité sont réappliquées (modes
sensibles refusés dans un univers reverrouillé entre-temps, classification jamais rétablie par
restauration, déverrouillage et reverrouillage non restaurables).

### Infrastructure

- Avertissement `pg` : origine identifiée (4 relations ou plus chargées d'un coup dans une
  transaction) et supprimée dans le code, sans changer de version ; un test en garantit
  l'absence.
- Scripts Prisma ignorés par pnpm : sans conséquence (vérifié) ; le choix est consigné dans
  `pnpm-workspace.yaml` et expliqué dans le README.

### Accessibilité des composants maison

Un contrôle automatique axe-core (WCAG 2.1 A et AA) couvre 7 pages. Il a révélé et fait corriger
deux défauts : contraste du bouton d'accent (valeur provisoire) et nom accessible de deux liens.
Reste à faire par une personne : essai au lecteur d'écran et revue du contraste avec la charte
définitive.

### Évolutions prévues (non réalisées)

- **Archivage distinct d'`EXCLUDED`** : ajouter une colonne `archivedAt` sur le personnage (un
  personnage archivé disparaît des listes et des tirages mais garde son statut et son historique)
  sans toucher aux règles d'éligibilité. Aucun changement de politique n'est nécessaire.
- **Double validation** : les seuls points d'entrée sensibles sont `setClassification` (vers
  `ADULT_VERIFIED`) et `unlockSensitive`. Ajouter une validation par un second administrateur
  reviendrait à y enregistrer une demande en attente au lieu d'appliquer le changement.

### Tests

| Suite                                  | Résultat                                 |
| -------------------------------------- | ---------------------------------------- |
| `packages/shared`                      | 50 réussis                               |
| `apps/server` (PostgreSQL réel)        | 93 réussis, sans avertissement du pilote |
| `apps/web`                             | 20 réussis                               |
| `e2e` (Playwright, dont accessibilité) | 11 réussis                               |
