# Politique de contenu et d'éligibilité

Ce document décrit les règles appliquées par le serveur. Le code de référence est
`packages/shared/src/policy/` ; l'interface d'administration ne fait qu'afficher son résultat.

## Deux réglages indépendants par personnage

| Réglage                        | Valeurs                                                                 | Qui le modifie                               |
| ------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------- |
| **Statut**                     | `ALLOWED`, `RESTRICTED` (défaut), `EXCLUDED`                            | Administrateur, individuellement ou en masse |
| **Classification de sécurité** | `UNKNOWN` (défaut), `ADULT_VERIFIED`, `MINOR`, `CHILDLIKE`, `AMBIGUOUS` | Administrateur, un personnage à la fois      |

`ALLOWED` signifie « actif dans le catalogue ». Il n'ouvre jamais un mode sensible à lui seul.

## Conditions d'un mode sensible

Un défi n'est éligible à un mode sensible que si **toutes** ces conditions sont vraies :

1. le personnage est classé `ADULT_VERIFIED` ;
2. son statut est `ALLOWED` ;
3. le mode est activé pour son univers, et l'univers n'est pas interdit de modes sensibles ;
4. le mode n'est pas bloqué pour ce personnage ;
5. aucune exclusion fondamentale ne s'applique ;
6. l'image a été approuvée individuellement pour un usage sensible.

Un mode neutre demande seulement un statut autre que `EXCLUDED`, un mode activé et non bloqué,
et une image approuvée.

## Exclusions fondamentales

Elles sont écrites dans `core-exclusions.ts` et ne sont pas modifiables depuis l'interface.

- **Annie et Zoé (League of Legends)** : jamais éligibles aux modes sensibles. La
  correspondance porte sur l'identifiant, tous les noms et tous les alias, dans toutes les
  langues, sans tenir compte des accents, de la casse ni de la ponctuation. Le serveur refuse
  de leur attribuer `ADULT_VERIFIED`.
- **Pokémon et Minecraft** : aucun mode sensible ne peut y être activé.

Les variantes et skins ne portent aucune règle : tout est lu sur le personnage.

## Critères de classification

`ADULT_VERIFIED` exige les trois critères suivants, vérifiés pour chaque personnage :

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

## Garde-fous de saisie

- `ADULT_VERIFIED` demande une case de confirmation et une justification écrite d'au moins
  20 caractères, enregistrées avec l'auteur et la date.
- Il ne peut pas être attribué en masse, ni à la création d'un personnage, ni par restauration
  d'un historique.
- Toute modification est journalisée avec son auteur, la valeur avant et la valeur après.

## Limite connue

Le système empêche les erreurs, pas la fraude délibérée : un administrateur peut créer un
personnage sous un faux nom et le classer adulte. Les garde-fous sont alors la justification
obligatoire, l'historique nominatif et la relecture individuelle de chaque image (lot 1C).
