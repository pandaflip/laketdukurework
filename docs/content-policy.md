# Politique de contenu et d'éligibilité

Ce document décrit les règles appliquées par le serveur. Le code de référence est
`packages/shared/src/policy/` ; l'interface d'administration ne fait qu'afficher son résultat.

## Cinq couches indépendantes

L'éligibilité d'un contenu résulte de cinq réglages distincts. Aucun ne peut en remplacer un autre.

| #   | Couche                                  | Valeurs                                                                     | Portée                          | Qui la modifie                               |
| --- | --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------- |
| 1   | **Activation des modes par univers**    | liste de modes                                                              | un univers                      | Administrateur                               |
| 2   | **Statut du personnage**                | `ALLOWED`, `RESTRICTED` (défaut), `EXCLUDED`                                | un personnage et ses variantes  | Administrateur, individuellement ou en masse |
| 3   | **Classification de sécurité**          | `UNKNOWN` (défaut), `ADULT_VERIFIED`, `MINOR`, `CHILDLIKE`, `AMBIGUOUS`     | un personnage et ses variantes  | Administrateur, un personnage à la fois      |
| 4   | **Exclusions fondamentales**            | liste écrite dans le code                                                   | personnages, niveaux d'audience | Code relu uniquement                         |
| 5   | **Approbation individuelle de l'image** | `UNVERIFIED` (défaut), `APPROVED_NEUTRAL`, `APPROVED_SENSITIVE`, `REJECTED` | une image                       | Administrateur (lot 1C)                      |

`ALLOWED` signifie « actif dans le catalogue ». Il n'ouvre jamais un mode sensible à lui seul.
Les variantes et skins ne portent aucune règle : tout est lu sur le personnage.

## Conditions d'un mode sensible

Un défi n'est éligible à un mode sensible que si **toutes** ces conditions sont vraies :

1. le personnage est classé `ADULT_VERIFIED` ;
2. son statut est `ALLOWED` ;
3. le mode est activé pour son univers ;
4. l'univers a été relu et classé `GENERAL`, ou classé `YOUTH` **et** explicitement déverrouillé (voir plus bas) ; jamais s'il est `UNREVIEWED` ;
5. le mode n'est pas bloqué pour ce personnage ;
6. aucune exclusion fondamentale ne s'applique ;
7. l'image a été approuvée individuellement pour un usage sensible (`APPROVED_SENSITIVE`).

Un mode neutre demande seulement un statut autre que `EXCLUDED`, un mode activé et non bloqué,
et une image approuvée (neutre ou sensible).

L'éligibilité d'un **personnage** (conditions 1 à 6) et l'approbation de ses **images**
(condition 7) sont affichées séparément dans l'interface : un défi jouable exige les deux.

## Classification d'audience des univers

Chaque univers porte une classification explicite, choisie par un administrateur :

| Valeur                | Sens                                | Modes sensibles                                       |
| --------------------- | ----------------------------------- | ----------------------------------------------------- |
| `UNREVIEWED` (défaut) | personne n'a relu l'univers         | impossibles                                           |
| `YOUTH`               | destiné à un jeune public           | possibles seulement après un déverrouillage explicite |
| `GENERAL`             | relu, pas destiné à un jeune public | possibles, sous toutes les autres conditions          |

Les personnages d'un univers ne sont jamais tenus pour mineurs ou inadaptés du seul fait de son
nom : c'est la relecture de l'univers, puis la classification de chaque personnage, qui décident.

- **Refus par défaut.** Tout nouvel univers est `UNREVIEWED`, côté base de données comme côté
  code. La création ne peut pas choisir une autre valeur ni activer un mode sensible.
- **Passage à `GENERAL`** : action explicite, par univers, avec case de confirmation et
  justification d'au moins 60 caractères ; journalisée (auteur, date, texte) et jamais
  restaurable. Elle n'active aucun mode par elle-même.
- **Passage à `YOUTH` ou `UNREVIEWED`** (sens plus strict) : immédiat, sans confirmation. Tous
  les modes sensibles de l'univers sont coupés et tout déverrouillage est effacé, de sorte
  qu'une classification plus permissive ne réactive jamais un mode en silence.
- **Plancher dans le code.** Pokémon et Minecraft (détectés sur l'identifiant immuable et sur le
  nom) sont toujours `YOUTH`, quelle que soit la valeur enregistrée : l'interface peut les
  rendre plus stricts, jamais plus permissifs (`AUDIENCE_FORBIDDEN`). Même une modification
  directe de la base ne les relâche pas.
- **Déverrouillage (`YOUTH` seulement).** Action distincte, avec confirmation et justification
  de 60 caractères, journalisée et jamais restaurable. Un univers `UNREVIEWED` ne peut pas être
  déverrouillé : il doit d'abord être classé. Le reverrouillage est immédiat et coupe les modes
  sensibles.
- **Justification renforcée.** Classer un personnage `ADULT_VERIFIED` demande 20 caractères dans
  un univers `GENERAL`, 60 dans un univers `YOUTH` ou `UNREVIEWED`.
- **Rien d'autre ne change.** Aucune classification ne dispense d'une autre condition : les
  personnages mineurs, d'apparence enfantine ou d'âge ambigu restent inéligibles, et chaque
  image doit être approuvée individuellement.
- **Données existantes.** La migration remet tous les univers existants à `UNREVIEWED`, coupe
  leurs modes sensibles et efface les déverrouillages : il faut les relire.

## Ce qui reste non configurable

Ces protections ne dépendent d'aucun réglage de l'interface :

| Protection                                                                                                                    | Où elle est appliquée                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Un personnage `MINOR`, `CHILDLIKE`, `AMBIGUOUS` ou `UNKNOWN` n'est jamais éligible à un mode sensible                         | Fonction d'éligibilité, à chaque calcul                                                                                |
| Annie et Zoé (League of Legends) sont exclues des modes sensibles et ne peuvent jamais être classées `ADULT_VERIFIED`         | Code (`core-exclusions.ts`) ; correspondance sur l'identifiant, tous les noms et tous les alias, sans accents ni casse |
| Aucune image non approuvée individuellement n'est utilisable dans un mode sensible                                            | Fonction d'éligibilité                                                                                                 |
| `ADULT_VERIFIED` : confirmation et justification obligatoires, jamais en masse, jamais à la création, jamais par restauration | Services serveur                                                                                                       |
| Les niveaux d'audience (liste des univers `YOUTH`)                                                                            | Code                                                                                                                   |
| Aucun contournement par renommage, alias, variante, modification groupée ou restauration                                      | Tests d'intégration                                                                                                    |
| Toute règle est réévaluée à chaque sélection, sans cache                                                                      | Service de sélection                                                                                                   |

## Approbation des images (lot 1C)

L'approbation d'une image est individuelle et porte sur ses **cadrages enregistrés** :

- une image importée est `UNVERIFIED` ; seule une action d'administrateur la fait changer ;
- approuver exige une séquence enregistrée ;
- l'approbation pour un mode neutre exige un personnage qui n'est pas `EXCLUDED` ;
- l'approbation pour un mode sensible exige une confirmation, une justification et **toutes** les
  conditions d'éligibilité du personnage, réévaluées par le serveur (les mêmes qu'à chaque
  sélection de défi) ; elle ne peut contourner ni l'audience de l'univers, ni la classification
  individuelle, ni les exclusions fondamentales, ni un mode désactivé ou bloqué ;
- modifier les cadrages d'une image approuvée retire son approbation ;
- une image rejetée n'est jamais jouable ;
- importation, séquence, revue et suppression sont journalisées et non restaurables.

Détails : `images-et-sequences.md`.

## Chaos Mix

Chaos Mix n'a pas de contenu propre : il tire des manches dans d'autres modes. Il est donc
déclaré **composite** et n'est jamais un mode de manche valide :

- l'éligibilité d'un personnage pour Chaos Mix est toujours « vérifiée par manche » ;
- chaque manche doit être contrôlée par le serveur sous son **mode réel** et pour l'**image
  utilisée** (`assertRoundEligible(db, mode, assetId)`) ; passer `chaos-mix` est refusé ;
- un mode sensible n'entre dans un mélange que s'il est lui-même éligible pour cette manche.

## Critères de classification

`ADULT_VERIFIED` exige trois critères, vérifiés pour chaque personnage :

1. un âge adulte établi par les sources officielles de l'éditeur ;
2. une apparence et une présentation non enfantines ;
3. l'absence d'ambiguïté.

Règles d'application :

- La petite taille seule ne suffit pas à classer un personnage comme mineur ou enfantin, et ne
  prouve pas non plus qu'il est adulte : chaque personnage est évalué individuellement.
- Une apparence ou une présentation enfantine est disqualifiante même si l'éditeur annonce un
  âge adulte (`CHILDLIKE`).
- Au moindre doute, choisir `AMBIGUOUS`.
- Un personnage non évalué reste `UNKNOWN`, donc inéligible.

## Historique et restauration

- Toute modification est journalisée avec son auteur, la valeur avant et la valeur après.
- Une restauration est elle-même journalisée (lien vers l'entrée d'origine) et peut à son tour
  être annulée, tant que rien de plus récent n'a modifié la donnée.
- Une restauration repasse par les services normaux : toutes les validations de sécurité sont
  réappliquées. Elle refuse d'écraser un changement plus récent (`RESTORE_CONFLICT`).
- Ne sont jamais restaurables : l'attribution de `ADULT_VERIFIED`, la classification d'audience,
  le déverrouillage et le reverrouillage d'un univers, la création et la suppression d'éléments.

## Limites connues

- Le système empêche les erreurs, pas la fraude délibérée : un administrateur peut créer un
  personnage sous un faux nom et le classer adulte, ou classer `GENERAL` un univers qui vise en
  réalité un jeune public sous un autre nom (le plancher du code ne reconnaît que les noms qu'il
  liste). Les garde-fous sont la relecture obligatoire de chaque univers, la justification de 60
  caractères, l'historique nominatif et la relecture individuelle de chaque image (lot 1C).
- Le plancher du code (univers toujours `YOUTH`, exclusions fondamentales) est volontairement
  court : toute extension passe par une modification de code relue.
