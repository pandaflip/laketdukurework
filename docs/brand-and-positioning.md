# Marque, Design System et positionnement

Document de cadrage. Rien ici n'est une charte graphique validée : les valeurs relevées sont
des observations, les choix restent à confirmer par l'équipe RESSA.

## Architecture de marque

- **RESSA** : marque principale.
- **RESSA Panda** : univers créatif, illustrations, boutique (`ressapanda.shop`).
- **RESSA Games** : jeux web. Chaque jeu peut avoir un nom et une direction artistique
  secondaires.

## Positionnement

- Jeux entièrement gratuits : ni publicité, ni abonnement, ni microtransaction, ni avantage
  payant, ni dons pour le moment.
- La boutique est une façon facultative de soutenir les créations. Aucun achat n'est requis
  pour accéder à une fonctionnalité.
- Infrastructure visée : un serveur unique, moins de 25 € TTC par mois tout compris.

## Design System : principes

1. **Tokens centralisés, en trois niveaux.**
   - Primitives : valeurs brutes de la marque (couleurs, polices, rayons, durées).
   - Sémantiques : rôles d'interface (`surface`, `text`, `accent`, `danger`, `radius-card`…).
     Les composants n'utilisent que ce niveau.
   - Thèmes : la plateforme et chaque jeu peuvent redéfinir les tokens sémantiques
     (`data-theme`), sans toucher aux composants.
2. **Valeurs provisoires tant que l'identité n'est pas validée.** Changer la charte doit
   revenir à modifier un seul fichier de tokens.
3. **Composants partagés** (boutons, cartes, champs, badges, dialogues) construits sur ces
   tokens ; un jeu ne redéfinit que son thème.
4. **Mascotte par emplacements.** Un composant unique reçoit une pose nommée (accueil,
   chargement, bonne réponse, erreur, victoire, défaite…). Sans illustration officielle, il
   n'affiche rien. Aucune mascotte n'est générée ni remplacée.
5. **Animations** : durées et courbes en tokens, respect de `prefers-reduced-motion`.
6. **Ton** : chaque langue est rédigée pour elle-même (en, fr, pt-BR), pas traduite mot à mot.

## Liens vers l'écosystème RESSA

- Un lien discret « RESSA Shop » dans le pied de page du portail, et à terme une page
  présentant les créations originales.
- Les liens sont décrits dans une configuration unique, avec un interrupteur global.
- Ils ne s'affichent que sur les pages du portail. Ils sont désactivés par défaut sur les
  pages de jeu, et toujours absents des salons et des manches.
- Aucune dépendance technique à Shopify : ce sont de simples liens.

### Précaution juridique

Un jeu gratuit qui renvoie vers une boutique peut être considéré comme participant à une
activité commerciale. Certains jeux utiliseront des personnages sous licence tierce (Riot
Games notamment). La séparation portail / jeux ci-dessus réduit l'exposition mais **n'est pas
une garantie juridique** : les autorisations doivent être vérifiées avant toute mise en ligne
publique, et aucun usage n'est présumé autorisé.

## Observations sur ressapanda.shop (novembre 2026)

La boutique est protégée par mot de passe : seule la page d'attente a pu être consultée, et
uniquement son code (les images n'ont pas été examinées).

| Élément             | Relevé                                                                          | Statut                               |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| Nom affiché         | « Ressa Panda »                                                                 | Existant                             |
| Thème Shopify       | Horizon 4.2                                                                     | Existant                             |
| Polices             | Archivo, Archivo Black, IBM Plex Mono                                           | Existant, intention à confirmer      |
| Couleurs dominantes | Noir `#000000`, blanc `#FFFFFF`                                                 | Existant                             |
| Couleurs d'accent   | `#EC6646`, `#933835`, `#F3EBDD`, `#232D3F`, `#EE9441`                           | Présentes dans le code, rôle inconnu |
| Rayons              | Boutons 14 px, pastilles 40 px                                                  | Peut-être les défauts du thème       |
| Éditorial           | Capsules et épisodes horodatés (« EP.01 00:47 »), ambiance nocturne, panda roux | Existant                             |
| Logo, mascotte      | Non identifiés                                                                  | À fournir                            |

## Éléments à fournir par l'équipe RESSA

1. Logos RESSA, RESSA Panda et RESSA Games (SVG ; versions claire, sombre, monochrome) et
   favicon.
2. Palette officielle avec le rôle de chaque couleur.
3. Polices retenues et leurs licences.
4. Références de la mascotte : poses, expressions, formats disponibles, nom, règles d'usage.
5. Exemples d'illustrations représentatives du style.
6. Exemples de ton éditorial (à faire et à éviter), si possible dans les trois langues.
7. Accès à la boutique (mot de passe ou captures d'écran).
8. Confirmation des droits sur les illustrations et la mascotte.
9. URL exactes des liens « RESSA Shop » et des réseaux à afficher.

## Intégration à la feuille de route

- **Lot 1B** : fichier de tokens, migration des quelques composants existants vers les tokens
  sémantiques, composants partagés branchés dessus. Valeurs provisoires.
- **Lot 1C** : inchangé.
- **Phase 2 et suivantes** : emplacements de mascotte dans les écrans de jeu, lien boutique
  dans le pied de page du portail, puis page des créations.
- **En parallèle, sans bloquer les lots** : validation de l'identité à partir des éléments
  fournis, puis remplacement des valeurs provisoires.
