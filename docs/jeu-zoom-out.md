# Zoom Out jouable : moteur de jeu (phase 2A)

Ce document décrit le moteur de la première version jouable : ses règles, ses contrats et les
choix d'architecture. Il n'y a, dans ce sous-lot, ni écran de jeu, ni salon réseau, ni
administration des catégories : ils arrivent en 2B et 2C.

## Principes

1. **Un moteur, sans réseau ni interface.** `apps/server/src/game/match.ts` est une machine
   d'états : aucune horloge, aucun socket, aucune base de données. Chaque méthode reçoit l'heure
   courante en millisecondes ; l'appelant programme un `tick` à `nextDeadline()`. Les tests
   rejouent donc des parties entières sans attendre.
2. **Le serveur est la seule autorité.** L'ordre des bonnes réponses est l'ordre dans lequel le
   serveur les traite ; aucun message client ne porte un score, un rang, un identifiant de
   joueur ou un droit d'hôte (l'identité vient de la connexion, voir `messages.ts`).
3. **Le solo est une salle d'un joueur.** Il n'y a pas de second moteur. Les variantes solo
   futures (dézoom manuel avec points selon les indices consommés, solo chronométré) seront
   d'autres _profils_ de règles (`PLAY_PROFILES`) : la progression et le calcul des points sont
   des règles du profil, pas du moteur.
4. **Les indices sont modulaires.** Le moteur ne connaît d'un défi que `ClueSource` (nombre
   d'indices, rendu d'un indice, image finale) et `AnswerKey` (réponse attendue). Zoom Out est
   une implémentation (`clues/zoom-out.ts`) ; Pixelated, Shadow Guess, Skin Detective ou
   Laketduku en seront d'autres sans toucher au moteur.
5. **Chaque mode garde ses règles d'éligibilité.** Le tirage appelle
   `challengeEligibility(modeId, …)` avec le mode joué. Aucune autorisation n'est héritée de
   Zoom Out : le mode sensible `historic` exige toujours ses propres conditions (approbation
   sensible, univers, classification, exclusions).

## Contrats (`packages/shared/src/game/`)

| Fichier       | Contenu                                                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| `config.ts`   | `RoomConfig` (validé par zod, options inconnues refusées), préréglages, durée estimée |
| `limits.ts`   | constantes fixes : joueurs 1–8, décompte, révélation, plafonds anti-spam, tolérance   |
| `scoring.ts`  | `rankPoints`, classement déterministe, vainqueurs                                     |
| `steps.ts`    | `selectStepIndices` : sous-ensemble régulier des étapes                               |
| `filters.ts`  | `ContentFilter` : univers (OU, SAUF) et catégories (OU, ET, SAUF)                     |
| `messages.ts` | messages client (`answer`, `vote`) strictement validés, pseudos                       |
| `views.ts`    | vue publique (identique pour tous) et vue privée (un joueur)                          |

### Configuration de l'hôte

| Option                 | Valeurs                                       | Défaut                   |
| ---------------------- | --------------------------------------------- | ------------------------ |
| Score cible            | 1 000 à 50 000                                | 5 000                    |
| Étapes demandées       | 3 à 20                                        | 10                       |
| Délai entre les étapes | 2 à 15 s                                      | 6 s                      |
| Tentatives             | illimitées / une par étape / limitées         | illimitées, délai de 2 s |
| Délai anti-spam        | 1 à 10 s (mode illimité)                      | 2 s                      |
| Maximum par manche     | 1 à 15 (mode limité)                          | 5                        |
| Vote pour dézoomer     | activé ou non ; seuil 50 % / 75 % / unanimité | activé, 50 %             |
| Tolérance aux fautes   | oui / non                                     | oui                      |
| Alias                  | oui / non                                     | oui                      |
| Mauvaises réponses     | masquées / affichées                          | masquées                 |
| Filtres                | univers, catégories (OU, ET, SAUF)            | aucun                    |

Préréglages (rythme seulement) : Rapide 8 étapes / 4 s, Normal 10 / 6 s, Détendu 15 / 8 s.

La durée normale d'une manche est `(étapes réelles − 1) × délai + temps final`, avec un temps
final de `max(délai, 8 s)` ; les votes ne peuvent que la raccourcir.

## Déroulement

`lobby` → `awaitingChallenge` → `countdown` (3 s) → `round` → `reveal` (8 s) → manche suivante ou
`finished`. Rien n'exige un clic de l'hôte après le lancement.

- Le premier indice apparaît dès le début de la manche ; les suivants à intervalle régulier,
  décidé par le serveur. Une mauvaise réponse ne change rien au rythme.
- La manche se termine quand le temps est écoulé ou que **tous les joueurs connectés** ont
  trouvé. Un joueur déconnecté ne bloque pas la fin ; il reprend sa place, son score et ses
  quotas en se reconnectant.
- La partie s'arrête après la manche où un joueur atteint le score cible, quand plus aucun défi
  éligible n'existe, ou après 30 manches. Victoire partagée si l'égalité persiste entre
  joueurs ayant marqué ; **si personne n'a marqué, la partie se termine sans vainqueur**
  (`winners` est alors une liste vide).
- On ne rejoint une salle que dans le salon d'attente.

### Points

`round(1000 × 0,8^(rang − 1))`, plancher 100 : 1000, 800, 640, 512, 410, 328, 262, 210. Le rang est
celui de l'arrivée de la bonne réponse au serveur : deux joueurs n'ont jamais le même rang
(l'ordre de traitement fait foi ; l'horodatage du client est ignoré). Une mauvaise réponse ou
aucune réponse vaut 0. Le classement est trié par points, puis manches gagnées en premier, puis
manches trouvées ; les joueurs égaux sur les trois critères partagent la place.

### Tentatives (contrôlées par le serveur)

- **Illimitées** : un délai minimal entre deux réponses (1 à 10 s) ; le serveur renvoie le temps
  restant.
- **Une par étape** : le droit est renouvelé à chaque nouvelle étape, que ce soit par le minuteur ou
  par un vote. Une réponse portant sur une étape déjà passée est refusée **sans être décomptée**.
- **Limitées** : au plus N réponses (1 à 15) dans la manche.
- Dans tous les modes : 400 ms au minimum entre deux réponses et 100 réponses au plus par manche,
  avec un refus explicite (`TECHNICAL_CAP`).
- Toute réponse bien formée est décomptée, juste ou fausse. Un message mal formé (vide, trop long,
  caractères de contrôle) est refusé sans être décompté. Les quotas sont tenus par joueur dans la
  manche : se reconnecter ne les remet pas à zéro.

### Vote pour dézoomer

- Électeurs : les joueurs **connectés** qui **n'ont pas encore trouvé**. Un joueur qui trouve
  cesse d'être électeur ; un joueur déconnecté n'est pas compté, et son vote redevient valable à
  sa reconnexion si l'étape est la même.
- Seuil : `ceil(50 % × électeurs)`, `ceil(75 % × électeurs)` ou tous les électeurs. À deux
  électeurs, 50 % revient à un seul vote.
- Un vote par joueur et par étape, non retirable ; un vote portant sur une étape déjà passée est
  rejeté. Aucun vote sur la dernière étape.
- Dès que le seuil est atteint, le serveur passe à l'étape suivante ; le délai complet repart. Deux
  étapes ne sont jamais affichées à moins de 1,5 s d'écart (le dézoom est alors différé). Le
  seuil est réévalué quand un électeur trouve, se déconnecte ou revient.

## Réponses

- Normalisation commune au catalogue : minuscules, sans accents ni ponctuation ni espaces.
- Noms officiels dans les trois langues, quelle que soit la langue de l'interface.
- **Tolérance aux fautes** (option) : distance d'édition avec permutation de deux lettres voisines
  (« Leblacn » pour « LeBlanc »). Noms de moins de 5 caractères : toujours exacts ; de 5 à 9 : une
  faute ; à partir de 10 : deux. Ne s'applique **jamais aux alias**.
- **Alias** (option, séparée) : correspondance exacte avec un alias explicitement enregistré.
- **Ambiguïtés refusées** : un nom ou un alias partagé par plusieurs personnages ne correspond à
  aucun ; une faute n'est acceptée que si aucun autre nom du catalogue entier n'est aussi proche.
  Un personnage dont aucun nom officiel n'est univoque n'est pas tiré.
- **Autocomplétion** : noms (pas d'alias, pas d'identifiants) de tout le catalogue non exclu,
  par langue, indépendamment du tirage.
- **Mauvaises réponses affichées** (option) : jamais une réponse qui nomme, abrège ou déforme la
  bonne, même refusée (par exemple l'alias quand les alias sont désactivés) : elle resterait une
  fuite. Son auteur la voit toujours dans sa propre vue.

## Sélection des défis

`ChallengePool` : à l'ouverture, liste les images **approuvées pour le mode joué** (`APPROVED_NEUTRAL`
pour Zoom Out : une approbation sensible ne vaut pas approbation neutre) avec une séquence, dont le personnage passe `challengeEligibility`, dont les
cadrages sont encore valides pour l'image, qui passent les filtres de l'hôte et dont le
personnage peut être identifié sans ambiguïté. Tirage aléatoire (générateur injecté, donc
rejouable), **une image et un personnage au plus une fois par partie**. Chaque défi est
**réévalué depuis la base juste avant sa manche** (approbation, statut, classification, univers,
modes activés, cadrages, fichier) : un contenu rejeté ou retiré en cours de partie est sauté.

- Le nombre minimal de défis pour démarrer est 5 (`MIN_POOL_SIZE`).
- Les **catégories** n'existent pas encore en base : `Candidate.categorySlugs` est vide jusqu'en
  2B, donc un filtre par catégorie ne retient rien. Les filtres par univers fonctionnent.
- Étapes : `selectStepIndices(disponibles, demandées)` garde la première et la dernière et répartit
  les autres ; si l'image en a moins, toutes sont jouées et le nombre réel est affiché. Aucun
  cadrage n'est inventé.

## Sécurité des images et des réponses

- L'image d'une étape est **découpée par le serveur dans l'original** (la version réduite serait
  floue à fort zoom), redimensionnée à 960 px de large au plus et réencodée sans métadonnées.
- Un indice n'a d'adresse (jeton aléatoire de 128 bits) **qu'à partir de sa révélation** ; l'adresse
  n'est valable que pour les joueurs de la partie (`Match.openFrame`) et disparaît à la manche
  suivante. Les rendus suivants peuvent être préparés en mémoire pour tenir le rythme, mais ne
  sont jamais transmis ni adressables avant leur étape.
- L'image entière (`display`) n'a une adresse qu'après la fin de la manche.
- Les vues ne contiennent ni la réponse, ni l'identifiant du personnage ou de l'image, ni le texte
  d'une bonne réponse. La réponse n'apparaît que dans `reveal`. Des tests parcourent toutes les
  sorties d'une manche à la recherche du nom, de l'univers et de l'image.
- Les identifiants des joueurs et des adresses d'images sont fournis par une fonction injectée
  (`newId`) : en production, des valeurs aléatoires non devinables (à brancher en 2B).

## Mémoire et images haute définition

Mesure indicative (machine de développement, images synthétiques, 20 frames par image, rendu
limité à 2 tâches simultanées, premier rendu avant les autres) :

| Image              | Premier rendu | 20 frames prêtes | Mémoire du processus (avant → pic) |
| ------------------ | ------------- | ---------------- | ---------------------------------- |
| 1 Mpx (1215 × 717) | 22 ms         | 0,5 s            | 102 → 242 Mo                       |
| 20 Mpx             | 0,33 s        | 4,0 s            | 299 → 609 Mo                       |
| 40 Mpx             | 0,61 s        | 7,4 s            | 386 → 995 Mo                       |

Le pic inclut les tampons du banc d'essai lui-même (image brute générée) : c'est une borne haute.
Le coût est dû au décodage complet de l'original à chaque frame (le format WebP ne permet pas de
lire une zone seule) : de l'ordre de 4 octets par pixel et par décodage en cours.

- Les frames de la manche sont rendues **l'une après l'autre**, et l'original lu n'est gardé en
  mémoire que pendant ces rendus ; il est libéré dès que la dernière frame est prête, et tout est
  libéré à la fin de la partie (`finish`), à la fermeture (`close`) et quand la manche suivante
  commence.
- Pour un splash art usuel (1 Mpx) le coût est négligeable. Une image de 40 Mpx, autorisée par la
  limite actuelle, peut approcher 1 Go de pic sur un petit hébergement : à mesurer avec vos vraies
  images en 2B, et à traiter si besoin (par exemple une version de jeu plafonnée à 4 000 px de
  large, calculée à l'import, qui bornerait la mémoire quelle que soit l'image importée).

## Ce qui reste pour 2B et 2C

- **2B** : WebSocket (`@fastify/websocket`), salons (code, limites par adresse, hôte, reconnexion
  par jeton secret, nettoyage), routes des images avec le jeton de joueur, envoi des vues,
  limitation de débit des messages, modèle `Category` / `CharacterCategory` et son administration
  minimale, écran de configuration de l'hôte avec le compteur de défis disponibles.
- **2C** : écrans de jeu (ordinateur et mobile), traductions EN / FR / PT-BR, essais multi-
  navigateurs, accessibilité, déploiement de test.

## Points d'attention

- **Approbations** : depuis la relecture de la PR 2A, un mode neutre n'accepte que
  `APPROVED_NEUTRAL`. Des autorisations par mode ou groupe de modes (une même image servant à
  plusieurs jeux) sont une évolution envisagée ; une image n'a aujourd'hui qu'une seule revue.
- **Salons en mémoire, une seule instance** : un redémarrage perd les parties en cours.
- **Équité** : l'ordre dépend de l'arrivée au serveur, donc de la latence de chaque joueur.
