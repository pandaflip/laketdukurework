# Zoom Out en réseau : salons et WebSocket (phase 2B-1)

Ce document décrit la couche réseau au-dessus du moteur (`docs/jeu-zoom-out.md`) : comment on crée
et rejoint un salon, comment un joueur est reconnu, ce que le serveur envoie et ce qu'il refuse.
Il n'y a pas encore d'écran de jeu (2C) ni de catégories (2B-2).

## Parcours

1. `POST /api/play/rooms` (pseudo, langue) crée un salon et son premier joueur, qui en est l'hôte.
2. `POST /api/play/rooms/:code/join` ajoute un joueur **tant que la partie n'a pas commencé** ; une
   personne déjà inscrite qui rappelle cette route retrouve sa propre identité.
3. `GET /api/play/rooms/:code` donne l'état public minimal (phase, nombre de joueurs, joignable ou
   non) : rien de nominatif.
4. `GET /api/play/rooms/:code/ws` ouvre la connexion WebSocket du joueur.
5. `GET /api/play/rooms/:code/frames/:token` sert l'image d'une étape déjà révélée.

Un salon inconnu, un code mal formé ou fermé donnent toujours la même réponse (`ROOM_NOT_FOUND`).

## Identité d'un joueur

- À la création ou à l'arrivée, le serveur tire un **secret de 256 bits**, ne garde que son
  **empreinte SHA-256** (comparée en temps constant) et le renvoie dans un **cookie** :
  `HttpOnly`, `SameSite=Strict`, `Secure` en production, durée de 6 h.
- Le cookie porte `<identifiant du joueur>.<secret>` et son **chemin est celui du salon**
  (`/api/play/rooms/<code>`) : le navigateur n'envoie jamais l'identité d'un salon à un autre, et
  plusieurs salons ouverts en même temps ne se mélangent pas.
- Le serveur ne se fie jamais à un identifiant donné dans un message : il connaît le joueur par la
  connexion, authentifiée **avant** la mise à niveau WebSocket (refus HTTP 401/403/404 sinon).
  Le secret d'un joueur ne permet rien dans un autre salon, et l'identifiant seul ne permet rien.
- Deux onglets du même navigateur partagent l'identité : le plus récent **remplace** l'ancien (code
  de fermeture 4001, message `closing: REPLACED`). Deux navigateurs, ou deux profils, sont deux
  joueurs.
- Les requêtes qui créent ou rejoignent un salon et l'ouverture du WebSocket exigent l'en-tête
  `Origin` de l'application web (`WEB_ORIGIN`) : une page d'un autre site ne peut pas agir au nom
  d'un joueur.

## Messages

Le serveur envoie (`packages/shared/src/game/protocol.ts`) :

| Message         | Contenu                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `welcome`       | code du salon, identifiant du joueur, noms à proposer (sa langue)             |
| `state`         | vue publique et vue privée du joueur, `version` croissante                    |
| `answerResult`  | résultat de sa réponse (juste, fausse, refusée et pourquoi, temps à attendre) |
| `voteResult`    | résultat de son vote                                                          |
| `commandResult` | résultat de `configure` ou `start` (réservés à l'hôte)                        |
| `pool`          | nombre de défis que les filtres de l'hôte laissent (à l'hôte, dans le salon)  |
| `error`         | `RATE_LIMITED`, `INVALID_MESSAGE`, `UNSUPPORTED`                              |
| `closing`       | `REPLACED`, `ROOM_CLOSED`, `SERVER_STOPPING`, `ABUSE`, `LEFT`                 |

Le client envoie `answer`, `vote`, `configure`, `start` ou `leave`, validés strictement : aucun champ
inconnu, aucun message ne porte un identifiant de joueur, un score ou un droit d'hôte. Les droits de
l'hôte sont vérifiés par le serveur à partir de l'identité de la connexion.

Les changements sont regroupés et envoyés au plus toutes les 30 ms environ. Les vues sont celles du
moteur : la réponse n'y figure qu'à la révélation.

## Images

L'adresse d'une étape est la même pour tout le salon (elle figure dans la vue publique) : **elle ne
prouve rien à elle seule**. Chaque requête vérifie, côté serveur :

1. que le **cookie** est celui d'un joueur de **ce** salon (le chemin de la requête désigne le salon) ;
2. que l'adresse existe dans **ce** salon, pour la manche en cours et pour une étape **déjà
   révélée** (les étapes futures n'ont pas d'adresse) ;
3. et répond **404 dans tous les autres cas**, sans distinguer les causes.

Réponse `Cache-Control: private, max-age=300`, `Vary: Cookie`, `Cross-Origin-Resource-Policy:
same-site`. Les adresses disparaissent avec la manche, et toutes à la fin de la partie.

## Reconnexion

- Une connexion perdue n'est signalée au jeu qu'après **5 secondes** (`PLAYER_GRACE_SECONDS`) : un
  changement de réseau sur mobile ne retire pas le joueur du vote ni de la fin anticipée de manche.
- Revenu avec son cookie, un joueur retrouve son identité, son score, son statut, ses tentatives et
  son vote : tout est tenu par le moteur, rien n'est lié à la connexion.
- Dans le salon d'attente, un joueur absent plus de 60 s (`LOBBY_LEAVE_SECONDS`) libère sa place ;
  une fois la partie lancée, il garde sa place indéfiniment. `leave` dans le salon d'attente libère la
  place tout de suite ; en partie, c'est une déconnexion immédiate.

## Limites et protections

| Protection                              | Valeur par défaut                               | Réglage                    |
| --------------------------------------- | ----------------------------------------------- | -------------------------- |
| Salons ouverts en tout                  | 50                                              | `MAX_ROOMS`                |
| Salons ouverts par adresse IP           | 3                                               | `MAX_ROOMS_PER_IP`         |
| Salon sans personne, en attente         | fermé après 2 min                               | `ROOM_EMPTY_LOBBY_MINUTES` |
| Salon sans personne, en partie          | fermé après 10 min                              | `ROOM_EMPTY_GAME_MINUTES`  |
| Partie terminée                         | fermée après 10 min                             | `ROOM_FINISHED_MINUTES`    |
| Salon sans aucune activité              | fermé après 30 min                              | `ROOM_IDLE_MINUTES`        |
| Délai de grâce de déconnexion           | 5 s                                             | `PLAYER_GRACE_SECONDS`     |
| Création, arrivée, connexion par minute | 10, 20, 60 par adresse                          | `PLAY_*_RATE_PER_MINUTE`   |
| Messages par seconde et par connexion   | 10 (rafale de 20), coupure après 5 abus en 10 s | `WS_MESSAGES_PER_SECOND`   |
| Client lent                             | coupé au-delà de 1 Mo en attente d'envoi        | `WS_MAX_BUFFERED_BYTES`    |
| Taille d'un message                     | 2 Ko (au-delà : connexion fermée, code 1009)    | fixe                       |
| Joueurs par salon                       | 8                                               | fixe                       |

Un message mal formé, trop nombreux ou binaire est refusé avec une erreur ; au bout de cinq en dix
secondes la connexion est fermée. Un battement de cœur toutes les 20 s ferme les connexions mortes.
À l'arrêt du serveur, chaque joueur reçoit `closing: SERVER_STOPPING` avant la coupure.

Les salons vivent en mémoire d'une seule instance : un redémarrage les termine (accepté pour la V1).
Le serveur ne journalise ni réponse, ni jeton, ni contenu de message.

## Mesurer la mémoire et le temps de rendu avec vos images

La commande suivante lit un dossier d'images **sans jamais le modifier**, les fait passer par le vrai
traitement d'import (mêmes limites), puis joue plusieurs salons en même temps : chaque salon découpe
les frames de sa manche dans l'original, avec le même plafond d'images simultanées que le serveur.
Rien n'est envoyé ni conservé : les fichiers temporaires sont supprimés à la fin.

```powershell
pnpm bench:render -- --dir "C:\chemin\vers\vos\images" --rooms 3 --rounds 2 --steps 10 --json bench-3-salons.json
```

| Option          | Rôle                                                   | Défaut                  |
| --------------- | ------------------------------------------------------ | ----------------------- |
| `--dir`         | dossier d'images (JPEG, PNG, WebP), obligatoire        |                         |
| `--rooms`       | salons qui démarrent une manche en même temps (1 à 50) | 3                       |
| `--rounds`      | manches jouées de suite par salon (1 à 20)             | 2                       |
| `--steps`       | frames par manche (3 à 20)                             | 10                      |
| `--limit`       | nombre d'images lues, dans l'ordre des noms            | 12                      |
| `--concurrency` | images traitées en même temps                          | `IMAGE_CONCURRENCY` (2) |
| `--json`        | écrit aussi le rapport dans ce fichier                 |                         |
| `--names`       | affiche les noms de fichiers (sinon `#1`, `#2`...)     | non                     |

Scénarios conseillés : `--rooms 1`, `--rooms 3`, `--rooms 8`, puis `--rooms 3 --steps 20` et
`--concurrency 1`. Le rapport donne par image les dimensions, le poids et la durée d'import, puis le
temps de la première frame (le début d'une manche), celui des frames prêtes, et la mémoire du
processus (au repos, pic, tas, tampons natifs). Les limites d'import ne sont pas relevées
(`UPLOAD_MAX_BYTES`, `IMAGE_MAX_PIXELS`) avant l'analyse de ces résultats.

La mémoire « au repos » est mesurée après l'import des images : elle inclut ce que le système
n'a pas encore rendu. Le chiffre utile est le pic.

## Limites connues

- Salons en mémoire, une seule instance ; l'ordre des réponses dépend de la latence de chaque joueur.
- Un salon dont on connaît le code peut être rempli par des inconnus tant qu'il est dans le salon
  d'attente (le code a 31⁶ combinaisons et les essais sont limités par adresse).
- Plusieurs joueurs derrière une même adresse partagent les plafonds par adresse.
