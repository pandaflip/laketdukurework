# Images et séquences Zoom Out (lot 1C)

Ce document décrit l'outil d'import des illustrations et l'éditeur de séquences : comment il
fonctionne, les règles que le serveur applique, et ses limites. Les règles d'éligibilité
elles-mêmes sont dans `content-policy.md`.

## Ce que l'outil fait

Un administrateur importe des illustrations pour un personnage, place un point de focus, choisit
le nombre d'étapes et les zooms de départ et d'arrivée, génère la séquence, la prévisualise, ajuste
des étapes à la main si besoin, l'enregistre, puis approuve ou rejette l'image. Une image peut être
retrouvée et modifiée plus tard. Il n'y a ni moteur de jeu, ni score, ni rendu des étapes pour les
joueurs dans ce lot.

- **Mode simple** (par défaut) : focus au clic, nombre d'étapes (5 par défaut), zoom initial,
  zoom final, ratio d'affichage, bouton « Générer ». Les noms d'étapes sont automatiques
  (« Étape 1 »…) et peuvent être personnalisés.
- **Mode avancé** : sélectionner une étape, déplacer et redimensionner son cadrage (souris ou
  clavier), ajouter, dupliquer, supprimer, réordonner, renommer, et régénérer depuis les réglages
  simples en conservant ou non les étapes ajustées à la main.
- **Aperçu** : au ratio du jeu (16:9 par défaut, 4:3 ou 1:1), étape précédente/suivante,
  sélection directe, flèches gauche/droite.
- **Productivité** : « Enregistrer et ajouter une autre image » (le personnage reste choisi),
  « Réutiliser les derniers réglages » (nombre d'étapes, zooms et ratio ; jamais le point focal,
  gardés dans le navigateur), import de plusieurs fichiers à la suite, « image suivante à relire ».
- Un brouillon s'enregistre sans approbation.

## Génération des cadrages

Le générateur est une fonction pure de `packages/shared/src/sequence/`, utilisée par le navigateur
(aperçu instantané) et testée seule. Le serveur ne régénère pas : il **revérifie** ce qu'il reçoit.

- **Repère** : tous les cadrages sont des rectangles `x, y, w, h` normalisés entre 0 et 1 dans
  l'image source. Rien ne dépend de la taille d'affichage.
- **Zoom** : le zoom 1 est le plus grand cadrage du ratio choisi qui tient dans l'image ; le zoom
  `z` est `z` fois plus petit. Le zoom initial doit être strictement plus élevé que le zoom final
  (sauf pour une seule étape).
- **Progression** : le zoom est interpolé géométriquement (chaque étape élargit du même facteur,
  ce qui paraît régulier à l'œil) ; le centre va en ligne droite de l'un à l'autre (il reste sur le
  focus quand les deux extrémités sont des zooms). Une seule étape donne le cadrage initial.
- **Extrémités** : un zoom, ou un cadrage donné directement.
- **Corrections prévisibles, signalées dans l'interface** : un zoom inférieur à 1 est remonté à 1 ;
  un zoom trop élevé est abaissé pour que le petit côté ne passe pas sous 24 pixels ; un cadrage
  qui n'a pas le bon ratio est ajusté autour de son centre ; un cadrage qui sortirait de l'image est
  décalé du minimum, jamais redimensionné (focus proche d'un bord, image portrait avec un ratio
  paysage…). Le focus reste visible dans chaque cadrage.
- **Déterminisme** : mêmes entrées, mêmes cadrages ; valeurs arrondies à six décimales.
- **Régénération** : avec « conserver », les étapes ajustées à la main restent identiques à leur
  position, les autres sont régénérées en gardant leur nom personnalisé ; celles qui dépassent la
  nouvelle longueur sont retirées et comptées. Sans « conserver », tout est régénéré.

## Modèle de données

L'`Asset` du lot 1B devient l'image ; rien n'est dupliqué.

| Table          | Rôle                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Asset`        | L'image : personnage propriétaire, skin facultatif, fichier (clé aléatoire, SHA-256), format d'origine, dimensions, revue (`UNVERIFIED` par défaut), dates |
| `Sequence`     | Les cadrages d'une image pour un mode (`zoom-out` pour l'instant), le ratio, les derniers réglages simples                                                 |
| `SequenceStep` | Une étape : position, nom facultatif, rectangle normalisé, indicateur « ajustée à la main »                                                                |

Plusieurs séquences par image et d'autres modes sont possibles sans changer le modèle ; un seul
éditeur existe. La migration supprime les anciennes lignes `Asset` du lot 1B : elles n'avaient pas
de fichier et n'étaient créables que par les tests.

## Stockage et traitement des fichiers

Dossier privé, configurable (`STORAGE_DIR`, par défaut `apps/server/storage`, ignoré par git),
jamais servi comme fichiers statiques :

```
<STORAGE_DIR>/original/<clé>.webp   source normalisée, sans perte, sans métadonnées
<STORAGE_DIR>/display/<clé>.webp    version réduite (1600 px max) utilisée par l'éditeur
<STORAGE_DIR>/thumb/<clé>.webp      miniature (320 px max) pour les listes
```

- **Validation** : le fichier est décodé par Sharp ; ni son nom, ni son type déclaré ne sont crus.
  Seuls JPEG, PNG et WebP **statiques** sont acceptés (ni SVG, ni GIF, ni AVIF, ni animation).
  Un fichier tronqué, illisible, trop petit ou trop grand est refusé avec un code stable.
- **Métadonnées** : l'orientation est appliquée puis EXIF, GPS, profils et commentaires sont
  supprimés ; tout ce qui suit l'image dans le fichier (code caché) disparaît au réencodage.
- **Noms** : clé aléatoire de 128 bits générée par le serveur ; aucun chemin ou nom du client ne
  sert de chemin système (le nom du fichier ne sert que de libellé d'affichage, nettoyé).
- **Atomicité** : écriture par fichier temporaire puis renommage ; l'enregistrement en base n'a lieu
  qu'après les trois fichiers ; en cas d'échec les fichiers écrits sont retirés. Le même fichier
  n'est jamais enregistré deux fois pour un personnage (y compris deux envois simultanés).
- **Orphelins** : `pnpm storage:prune` liste les fichiers que plus aucune image ne référence ;
  `--apply` les supprime. Les fichiers de moins de dix minutes sont épargnés.
- **Accès** : uniquement `GET /api/admin/images/:id/file/(thumb|display|original)`, avec session
  d'administrateur, `Cache-Control: private, no-cache` et ETag.

### Limites

| Limite                                         | Valeur par défaut                            | Réglage             |
| ---------------------------------------------- | -------------------------------------------- | ------------------- |
| Poids d'un fichier                             | 15 Mo                                        | `UPLOAD_MAX_BYTES`  |
| Dimensions d'une image                         | 40 mégapixels                                | `IMAGE_MAX_PIXELS`  |
| Plus petit côté                                | 256 px                                       | `IMAGE_MIN_SIDE`    |
| Images traitées en même temps                  | 2                                            | `IMAGE_CONCURRENCY` |
| Étapes par séquence                            | 100                                          | fixe                |
| Zoom maximal                                   | ×20, abaissé pour garder 24 px au petit côté | fixe                |
| Longueur d'un nom d'étape                      | 80 caractères                                | fixe                |
| Imports par minute et par adresse              | 120                                          | fixe                |
| Requêtes de fichiers par minute et par adresse | 3 000                                        | fixe                |

Les étapes et le zoom sont des limites techniques, pas des règles métier : le nombre d'étapes reste
libre dans cette limite.

## Revue et sécurité

- Une image importée est **toujours** `UNVERIFIED`. Aucune action d'import n'approuve quoi que ce soit.
- **Approuver exige une séquence enregistrée** : l'approbation porte sur ses cadrages.
- **Modes neutres** : le personnage ne doit pas être `EXCLUDED`.
- **Modes sensibles** : confirmation explicite, justification d'au moins 20 caractères, et
  **toute** l'éligibilité du personnage, réévaluée par le serveur : classification d'audience de
  l'univers (et déverrouillage), classification individuelle `ADULT_VERIFIED`, statut `ALLOWED`,
  exclusions fondamentales, mode activé et non bloqué. `APPROVED_SENSITIVE` ne contourne aucune
  de ces conditions, ni à l'approbation, ni à chaque sélection de défi (`checkRoundEligibility`).
- **Modifier les cadrages d'une image approuvée retire son approbation** (l'image redevient
  `UNVERIFIED` et l'historique le dit). Enregistrer sans rien changer ne touche à rien.
- **Rejeter** est toujours possible et une image rejetée n'est jamais jouable ; **remettre en non
  vérifiée** aussi.
- Importation, séquence, revue et suppression sont journalisées dans l'historique du personnage et
  ne sont **pas restaurables**.
- Chaque route exige une session ; les routes qui modifient vérifient l'origine ; les identifiants
  n'acceptent que des caractères d'identifiants ; les cadrages sont revérifiés (bornes, ratio,
  taille minimale, nombre) quoi qu'ait fait le navigateur.

## Essais manuels avec de vrais splash arts

Le dossier `LoL_Female_Splasharts` n'existe que sur le PC de l'administrateur. Rien ne le lit :
ni le développement, ni la CI. Pour essayer l'éditeur :

1. Lancer l'application (`pnpm dev`), se connecter, ouvrir **Images**.
2. Chercher un personnage, le choisir, puis **Choisir des fichiers** (ou glisser-déposer) et
   sélectionner **quelques** images seulement.
3. Ouvrir l'éditeur d'une image, cliquer le focus, générer 5, 15 puis 30 étapes, essayer le mode
   avancé, enregistrer, rouvrir.

Les images importées vivent dans `apps/server/storage/` (ignoré par git, ainsi que tout dossier
`storage/`, `LoL_Female_Splasharts/`, `test-images/`). **Elles ne sont jamais approuvées par leur
présence** : elles restent `UNVERIFIED` tant que quelqu'un ne les a pas relues.

Pour des images sans droits : `pnpm samples:generate` écrit six images synthétiques (paysage,
portrait, carré, 4K, 6K) dans `apps/server/test-images/`.

## Limites connues

- L'import traite les fichiers un par un (la barre de progression est celle de la file, pas du
  fichier).
- Le traitement d'une image de 20 mégapixels prend environ une à deux secondes ; un splash art
  usuel (1215 × 717) prend une fraction de seconde (mesures dans le rapport du lot).
- Pas de rendu des étapes pour les joueurs : **à faire en phase 2**, côté serveur, à partir de
  l'original, de sorte qu'aucun joueur ne reçoive l'image complète avant la révélation. La
  version `display` reste réservée à l'administration.
- Une seule séquence `zoom-out` est éditable par image.
- Le glisser-déposer des cadrages est testé à la souris et au clavier, pas au doigt.
- Pas de vérification antivirus : les fichiers sont réencodés, jamais servis tels quels.
