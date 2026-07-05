# Blobule

🇬🇧 [English version](README.md)

Clone libre et open source d'[agar.io](https://agar.io), **sans serveur de
jeu** : tout tourne dans le navigateur, en pair-à-pair (WebRTC).

![Partie en cours](assets/screenshot.png)

## Fonctionnement

- **L'hôte est le serveur.** Le joueur qui crée la partie exécute la simulation
  dans son navigateur. Aucun backend à déployer ni à payer.
- **Nombre de joueurs au choix** (2 à 12). Chaque place sans humain est tenue
  par une IA.
- **Invitation par lien.** L'hôte partage un lien (ou un code) ; quand un ami
  rejoint, il remplace une IA. S'il part, une IA reprend sa place.
- Le serveur public [PeerJS](https://peerjs.com) n'est utilisé que pour la mise
  en relation initiale (signaling WebRTC) — aucune donnée de jeu n'y transite.

## Jouer

La version hébergée sur GitHub Pages est le plus simple :
**<https://flamme-demon.github.io/blobule/>**

### En local (solo + IA)

Ouvrez simplement `index.html` dans un navigateur, ou lancez un petit serveur
statique :

```bash
python3 -m http.server 8080
# puis http://localhost:8080
```

### Inviter des amis depuis chez soi (tunnel)

Aucun port à ouvrir : le jeu passe en WebRTC, qui traverse les box/NAT tout
seul. Il faut seulement que la **page** du jeu soit accessible à vos amis.
Si vous ne passez pas par la version GitHub Pages, un tunnel fait l'affaire :

```bash
python3 -m http.server 8123 &          # sert le jeu en local
cloudflared tunnel --url http://localhost:8123
# → affiche une URL du type https://xxxx.trycloudflare.com
```

Ouvrez cette URL (pas localhost !), créez la partie : le lien d'invitation
généré fonctionne alors pour tout le monde, tant que le tunnel est ouvert.
Alternative sans rien installer (mais sessions courtes en anonyme) :
`ssh -R 80:localhost:8123 -o ServerAliveInterval=30 nokey@localhost.run`.

Si le tunnel se ferme en pleine partie, les joueurs déjà connectés ne sont
**pas** éjectés : le jeu passe en WebRTC direct entre navigateurs. Seuls les
nouveaux arrivants ont besoin que la page soit accessible.

## Commandes

| Entrée   | Action                    |
|----------|---------------------------|
| Souris   | Diriger ses cellules      |
| `Espace` | Se diviser (split)        |
| `W`      | Éjecter de la masse       |

## Mécaniques

- Manger la nourriture et les joueurs plus petits (25 % de masse d'écart
  minimum) pour grossir ; la vitesse diminue avec la taille.
- Division en deux (jusqu'à 16 cellules) projetée vers le curseur ;
  re-fusion possible après un délai, en regroupant ses cellules.
- Éjection de masse pour appâter, nourrir un allié… ou un virus.
- Virus (verts) : une grosse cellule qui en touche un explose en morceaux.
  Nourri de 7 éjections, un virus gonfle à vue d'œil puis se scinde en
  projetant un nouveau virus — de quoi piéger les gros.
- Perte de masse progressive, classement en direct, réapparition à la demande.

## Architecture

```
index.html      interface (menu, HUD)
style.css
js/config.js    constantes et formules (rayon, vitesse, fusion)
js/sim.js       simulation du monde + IA des bots (sans DOM, testable sous Node)
js/render.js    rendu canvas + caméra
js/net.js       P2P PeerJS : hôte autoritaire, invités en entrées/état
js/main.js      menu, boucle de jeu, entrées, HUD
```

L'hôte diffuse ~15 snapshots/s (~1–2 Ko chacun) ; les invités n'envoient que
leur cible souris et leurs actions. La nourriture est synchronisée par
différences (ajouts/retraits), pas retransmise en entier.

## Limites connues

- Si l'hôte ferme son onglet, la partie s'arrête pour tout le monde.
- Le signaling repose sur le serveur public PeerJS (gratuit) ; on peut
  auto-héberger [peerjs-server](https://github.com/peers/peerjs-server) si besoin.
- Pas encore de support tactile (mobile) — contributions bienvenues !

## Licence

[MIT](LICENSE) — faites-en ce que vous voulez.

Blobule est un projet indépendant, non affilié à Miniclip ni à agar.io.
