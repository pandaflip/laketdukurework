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
4. si l'univers est à jeune public : il a été explicitement déverrouillé (voir plus bas) ;
5. le mode n'est pas bloqué pour ce personnage ;
6. aucune exclusion fondamentale ne s'applique ;
7. l'image a été approuvée individuellement pour un usage sensible (`APPROVED_SENSITIVE`).

Un mode neutre demande seulement un statut autre que `EXCLUDED`, un mode activé et non bloqué,
et une image approuvée (neutre ou sensible).

L'éligibilité d'un **personnage** (conditions 1 à 6) et l'approbation de ses **images**
(condition 7) sont affichées séparément dans l'interface : un défi jouable exige les deux.

## Univers à jeune public (Pokémon, Minecraft)

Il n'y a plus d'interdiction définitive fondée sur le nom de l'univers : les personnages d'un
univers ne sont pas tenus pour mineurs ou inadaptés du seul fait de l'univers. À la place,
ces univers appartiennent à un niveau d'audience `YOUTH`, défini dans le code, avec une
approche prudente :

- **Verrouillés par défaut.** Un nouvel univers de ce type ne peut activer aucun mode sensible.
  La détection porte sur l'identifiant immuable et sur le nom : renommer l'univers ne la contourne pas.
- **Déverrouillage explicite.** Une action distincte, par univers, demande une case de
  confirmation et une justification d'au moins 60 caractères. Elle est journalisée (auteur,
  date, justification) et **n'est jamais restaurable**. Elle n'active aucun mode par elle-même.
- **Reverrouillage immédiat.** Sans confirmation, il désactive aussitôt tous les modes
  sensibles de l'univers. Il n'est pas non plus restaurable.
- **Justification renforcée.** Classer un personnage `ADULT_VERIFIED` dans un univers `YOUTH`
  demande 60 caractères au lieu de 20.
- **Rien d'autre ne change.** Le déverrouillage ne dispense d'aucune autre condition : les
  personnages mineurs, d'apparence enfantine ou d'âge ambigu restent inéligibles, et chaque
  image doit être approuvée.

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
- Ne sont jamais restaurables : l'attribution de `ADULT_VERIFIED`, le déverrouillage et le
  reverrouillage d'un univers, la création et la suppression d'éléments.

## Limites connues

- Le système empêche les erreurs, pas la fraude délibérée : un administrateur peut créer un
  personnage sous un faux nom et le classer adulte, ou créer un univers à jeune public sous un
  autre nom. Les garde-fous sont la justification obligatoire, l'historique nominatif et la
  relecture individuelle de chaque image (lot 1C).
- La liste des univers à jeune public et des exclusions fondamentales est volontairement courte :
  toute extension passe par une modification de code relue.
