# Phase 1 — Lot 1C : gestion des images et éditeur de séquences Zoom Out

## Périmètre livré

- **Import** d'illustrations par sélection de fichiers ou glisser-déposer, plusieurs à la suite,
  pour un personnage choisi ; validation par décodage (JPEG, PNG, WebP statiques), limites
  configurables, métadonnées supprimées, noms aléatoires, stockage privé, atomicité, doublons.
- **Éditeur de séquences** : mode simple (focus, nombre d'étapes libre, zoom initial et final,
  ratio, génération) et mode avancé (déplacer, redimensionner, ajouter, dupliquer, supprimer,
  réordonner, renommer, régénérer en conservant les étapes ajustées à la main) ; aperçu au ratio
  du jeu ; enregistrement et réouverture.
- **Revue** : approuver (neutre ou sensible), rejeter, remettre en non vérifiée, avec réévaluation
  complète des règles par le serveur ; « image suivante à relire ».
- **Productivité** : enregistrer et ajouter une autre image (personnage conservé), réutiliser les
  derniers réglages (jamais le point focal), import de plusieurs fichiers à la suite.
- Section **Images** de l'administration, accessible aussi depuis la fiche personnage ; trois langues.
- Générateur de cadrages **pur** dans `packages/shared`, avec validation partagée.
- Outils : `pnpm samples:generate` (images synthétiques), `pnpm storage:prune` (fichiers orphelins).

Hors périmètre, non réalisé : moteur de jeu, score, classements, multijoueur, autres éditeurs de
modes, IA, vidéo, détourage, stockage cloud, comptes joueurs.

Spécification et règles détaillées : `docs/images-et-sequences.md`.

## Fichiers principaux

| Zone                                    | Fichiers                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/shared/src/sequence/`         | `generate.ts` (générateur), `geometry.ts`, `validate.ts`, `constants.ts`, tests               |
| `packages/shared/src/catalog/images.ts` | schémas de requête et DTO des images et séquences                                             |
| `apps/server/prisma`                    | migration `images_and_sequences` : `Asset` enrichi, `Sequence`, `SequenceStep`                |
| `apps/server/src/modules/images/`       | `storage.ts`, `processing.ts` (Sharp), `service.ts`, `routes.ts`                              |
| `apps/server/src/cli/`                  | `make-samples.ts`, `storage-prune.ts`                                                         |
| `apps/web/src/admin/images/`            | `ImagesPage`, `ImageEditorPage`, `SequenceEditor`, `SourceCanvas`, `FrameView`, `ReviewPanel` |
| Tests                                   | `apps/server/test/{images,sequences}.int.test.ts`, `e2e/tests/images.spec.ts`                 |

## Tests

| Suite                                                                            | Résultat                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `packages/shared` (dont générateur et propriétés)                                | 101 réussis (56 avant)                         |
| `apps/server` (PostgreSQL réel, Sharp réel)                                      | 175 réussis (110 avant)                        |
| `apps/web`                                                                       | 23 réussis (20 avant)                          |
| Playwright (dont import, 15 étapes, ajustement, clavier, accessibilité)          | 25 réussis (13 avant), stable sur 3 exécutions |
| Build de production, secrets absents des bundles, serveur compilé essayé en réel | Vérifiés                                       |
| Migration sur base vierge et sur base contenant un `Asset` du lot 1B             | Vérifiée                                       |

Les tests utilisent uniquement des images synthétiques générées en mémoire.

Contrôles faits exprès : deux règles de sécurité ont été cassées volontairement (approbation
sensible qui ignore l'éligibilité ; modification des cadrages qui conserve l'approbation) et la
limite de débit de la route des fichiers a été retirée ; les tests échouent bien à chaque fois.

## Mesures (machine de développement)

| Image importée (PNG synthétique)          | Traitement complet (décodage, original sans perte, deux versions réduites) |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| 1215 × 717 (taille d'un splash art usuel) | ≈ 0,1 s                                                                    |
| 1920 × 1080                               | ≈ 0,2 s                                                                    |
| 3840 × 2160                               | ≈ 0,6 s                                                                    |
| 6000 × 3375 (20 mégapixels)               | ≈ 1,1 à 1,4 s                                                              |

Mesures du traitement seul, sans le réseau. Avec l'encodage sans perte le plus poussé, 20
mégapixels prenaient environ 8 s : le choix d'un encodage rapide coûte un original d'environ un
quart plus gros, sans importance pour quelques dizaines d'images. Les images réelles (peintes,
plus détaillées) seront plus lourdes que ces motifs synthétiques.

Dans le navigateur, générer 30 étapes sur une image 4K et afficher la bande d'aperçu prend moins
de 3 s (seuil vérifié par un test).

## Défauts trouvés et corrigés pendant le lot

- Un identifiant contenant un octet nul faisait répondre 500 : tous les identifiants n'acceptent
  désormais que des caractères d'identifiants (aussi pour les routes du lot 1B).
- La limite globale de 300 requêtes par minute était atteinte par une page d'éditeur (une image
  par étape affichée) : la route des fichiers a sa propre limite.
- Supprimer une image attendait environ sept secondes avant de quitter sa page (rechargement
  d'une ressource disparue, répété trois fois) : navigation immédiate, et les refus du serveur
  (4xx) ne sont plus retentés.
- Les miniatures décoratives de la bande d'étapes avaient un rôle d'image sans nom (accessibilité).

## Limites connues

- Pas de rendu des étapes pour les joueurs : phase 2, côté serveur, à partir de l'original.
- Un seul éditeur (Zoom Out) et une séquence par image ; le modèle accepte davantage.
- Les imports sont traités un par un côté navigateur.
- Déplacement des cadrages testé à la souris et au clavier, pas au doigt.
- Pas d'essai au lecteur d'écran ; l'analyse automatique (axe-core) couvre l'éditeur et la liste.
- La croix de focus recouvre le centre du cadrage en mode avancé : le cadrage se saisit ailleurs.
- Le stockage est local ; une sauvegarde du dossier est à prévoir avec celle de la base.
- Les originaux sont normalisés (WebP sans perte), pas conservés octet pour octet.

## Vérification locale sous Windows

Après avoir récupéré la branche :

```bash
pnpm install
```

```bash
pnpm db:migrate
```

```bash
pnpm dev
```

1. Ouvrir <http://localhost:5173/admin>, onglet **Images**.
2. Chercher un personnage, le choisir, puis **Choisir des fichiers** et sélectionner **quelques**
   splash arts (pas le dossier entier). Essayer aussi le glisser-déposer et plusieurs fichiers à la fois.
3. Ouvrir une image : cliquer le focus, générer 5, puis 15, puis 30 étapes ; parcourir l'aperçu.
4. Passer en mode avancé, ajuster une étape, régénérer avec et sans « conserver ».
5. Enregistrer, recharger la page, vérifier que tout est revenu ; essayer « Enregistrer et ajouter
   une autre image » puis « Réutiliser les derniers réglages ».
6. Approuver pour les modes neutres ; modifier un cadrage et enregistrer : l'approbation est retirée.
7. Sur un personnage non vérifié adulte, constater que l'approbation sensible est refusée avec ses raisons.
8. Les fichiers sont dans `apps/server/storage/` et n'apparaissent pas dans `git status`.

## Points à arbitrer

1. **Ratio de jeu** : 16:9 par défaut, avec 4:3 et 1:1. À confirmer ou remplacer avant la phase 2.
2. **Approbation par cadrages** : toute modification des cadrages retire l'approbation, même
   neutre. Plus prudent qu'une relecture seulement pour les modes sensibles ; à assouplir si cela
   gêne la production.
3. **Taille maximale** : 15 Mo et 40 mégapixels par défaut, selon vos splash arts réels.
4. **Sauvegarde** du dossier de stockage et hébergement (disque, volume) à décider avant la mise en ligne.
