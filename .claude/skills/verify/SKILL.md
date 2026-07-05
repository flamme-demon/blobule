---
name: verify
description: Vérifie Blobule de bout en bout (serveur statique + Chromium headless piloté par puppeteer-core)
---

# Vérifier Blobule

Jeu statique (pas de build). Surface : GUI navigateur.

## Lancer

```bash
cd /home/flamme/dev/blobule && python3 -m http.server 8123   # en arrière-plan
```

## Piloter

`npm install puppeteer-core` dans le scratchpad, puis
`puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] })`.

- Menu : remplir `#nameInput`, cliquer `#hostBtn` (héberger) ou `#joinInput` + `#joinBtn` (rejoindre).
- Le multijoueur P2P (PeerJS, serveur public de signaling) fonctionne en headless
  entre deux pages du même navigateur : lire `#inviteLink` chez l'hôte, le coller
  chez l'invité.
- Débogage : côté hôte, `window.__world` expose la simulation
  (`__world.players`, `.ejected`, `.viruses`). Pratique pour se donner de la
  masse (`players.get('me').cells[0].m = 300`) avant de tester split
  (`Espace`, masse min 36), éjection (`W`), virus, fusion.

## Pièges

- À la masse de départ (25), split et éjection sont impossibles (min 36) —
  se donner de la masse d'abord.
- La re-fusion n'a lieu que si les cellules se rejoignent : mettre la souris
  au **centre de l'écran** (cible = centroïde), sinon elles courent en
  parallèle sans se toucher.
- `#nameInput` est pré-rempli depuis localStorage : le vider avant `page.type`.
- La détection de départ d'un invité prend jusqu'à ~5 s (timeout d'entrées).
- La sim pure est testable sous Node : `require('./js/sim.js')` (sans DOM).
