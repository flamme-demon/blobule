// Simulation du monde — tourne uniquement chez l'hôte (ou en solo).
// Sans dépendance au DOM : testable sous Node.
(function (global) {
  const C = (typeof module !== 'undefined' && module.exports)
    ? require('./config.js')
    : global.CFG;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function randomColor() { return 'hsl(' + Math.floor(rnd(0, 360)) + ',72%,54%)'; }

  class World {
    constructor() {
      this.time = 0;
      this.nextId = 1;
      this.players = new Map();   // id -> player
      this.pellets = new Map();   // id -> {id,x,y,c}
      this.ejected = new Map();   // id -> {id,x,y,vx,vy,c,owner,born}
      this.viruses = new Map();   // id -> {id,x,y,vx,vy,fed}
      this.pelletsAdded = [];     // événements du tick (pour le réseau)
      this.pelletsRemoved = [];
      for (let i = 0; i < C.PELLET_COUNT; i++) this.spawnPellet(true);
      for (let i = 0; i < C.VIRUS_COUNT; i++) this.spawnVirus();
    }

    id() { return this.nextId++; }

    spawnPellet(silent) {
      const p = {
        id: this.id(),
        x: rnd(20, C.WORLD - 20),
        y: rnd(20, C.WORLD - 20),
        c: randomColor(),
      };
      this.pellets.set(p.id, p);
      if (!silent) this.pelletsAdded.push(p);
      return p;
    }

    removePellet(p) {
      this.pellets.delete(p.id);
      this.pelletsRemoved.push(p.id);
    }

    spawnVirus(x, y, vx, vy) {
      const v = {
        id: this.id(),
        x: x !== undefined ? x : rnd(200, C.WORLD - 200),
        y: y !== undefined ? y : rnd(200, C.WORLD - 200),
        vx: vx || 0, vy: vy || 0,
        m: C.VIRUS_MASS, // gonfle à chaque blob avalé, redescend en se scindant
        fed: 0,
      };
      this.viruses.set(v.id, v);
      return v;
    }

    addPlayer(id, name, isBot) {
      const p = {
        id, name: name || 'Anonyme',
        color: randomColor(),
        isBot: !!isBot,
        cells: [],
        tx: C.WORLD / 2, ty: C.WORLD / 2, // cible (souris ou décision du bot)
        wantSplit: false, wantEject: false,
        dead: true,
        respawnAt: 0,
        botNextThink: 0,
        score: 0,
      };
      this.players.set(id, p);
      this.respawn(p);
      return p;
    }

    removePlayer(id) { this.players.delete(id); }

    respawn(p) {
      p.cells = [this.makeCell(rnd(100, C.WORLD - 100), rnd(100, C.WORLD - 100), C.START_MASS)];
      p.tx = p.cells[0].x; p.ty = p.cells[0].y;
      p.dead = false;
    }

    makeCell(x, y, m, vx, vy) {
      return { id: this.id(), x, y, m, vx: vx || 0, vy: vy || 0, mergeAt: 0 };
    }

    setInput(id, input) {
      const p = this.players.get(id);
      if (!p) return;
      if (typeof input.tx === 'number' && isFinite(input.tx)) p.tx = input.tx;
      if (typeof input.ty === 'number' && isFinite(input.ty)) p.ty = input.ty;
      if (input.split) p.wantSplit = true;
      if (input.eject) p.wantEject = true;
    }

    playerMass(p) { return p.cells.reduce((s, c) => s + c.m, 0); }

    // ---- actions ----

    trySplit(p) {
      const now = this.time;
      const cells = p.cells.slice().sort((a, b) => b.m - a.m);
      for (const cell of cells) {
        if (p.cells.length >= C.MAX_CELLS) break;
        if (cell.m < C.MIN_SPLIT_MASS) continue;
        cell.m /= 2;
        const dx = p.tx - cell.x, dy = p.ty - cell.y;
        const d = Math.hypot(dx, dy) || 1;
        const kid = this.makeCell(cell.x, cell.y, cell.m,
          (dx / d) * C.SPLIT_IMPULSE, (dy / d) * C.SPLIT_IMPULSE);
        const delay = C.mergeDelay(cell.m);
        cell.mergeAt = now + delay;
        kid.mergeAt = now + delay;
        p.cells.push(kid);
      }
    }

    tryEject(p) {
      for (const cell of p.cells) {
        if (cell.m < C.MIN_EJECT_MASS + C.EJECT_LOSS) continue;
        cell.m -= C.EJECT_LOSS;
        const dx = p.tx - cell.x, dy = p.ty - cell.y;
        const d = Math.hypot(dx, dy) || 1;
        const r = C.radius(cell.m);
        const e = {
          id: this.id(),
          x: cell.x + (dx / d) * r,
          y: cell.y + (dy / d) * r,
          vx: (dx / d) * C.EJECT_SPEED,
          vy: (dy / d) * C.EJECT_SPEED,
          c: p.color, owner: p.id, born: this.time,
        };
        this.ejected.set(e.id, e);
      }
    }

    explodeCell(p, cell) {
      // Explosion sur un virus : la cellule se fragmente.
      const room = C.MAX_CELLS - p.cells.length;
      if (room <= 0) return;
      const pieces = Math.min(room, Math.max(2, Math.floor(cell.m / C.MIN_SPLIT_MASS)));
      const pieceMass = cell.m / (pieces + 1);
      cell.m = pieceMass;
      const delay = C.mergeDelay(pieceMass);
      cell.mergeAt = this.time + delay;
      for (let i = 0; i < pieces; i++) {
        const a = rnd(0, Math.PI * 2);
        const kid = this.makeCell(cell.x, cell.y, pieceMass,
          Math.cos(a) * C.SPLIT_IMPULSE, Math.sin(a) * C.SPLIT_IMPULSE);
        kid.mergeAt = this.time + delay;
        p.cells.push(kid);
      }
    }

    // ---- tick ----

    tick(dtMs) {
      const dt = dtMs / 1000;
      this.time += dtMs;
      // Les diffs de nourriture s'accumulent sur plusieurs ticks et sont
      // drainés par snapshot() à chaque envoi réseau. Garde-fou pour le
      // solo hors-ligne, où personne ne les consomme :
      if (this.pelletsAdded.length > 2000 || this.pelletsRemoved.length > 2000) {
        this.pelletsAdded = [];
        this.pelletsRemoved = [];
      }

      for (const p of this.players.values()) {
        if (p.dead) {
          if (p.isBot && this.time >= p.respawnAt) this.respawn(p);
          continue;
        }
        if (p.isBot) this.botThink(p);
        if (p.wantSplit) { this.trySplit(p); p.wantSplit = false; }
        if (p.wantEject) { this.tryEject(p); p.wantEject = false; }
        this.moveCells(p, dt);
        this.resolveOwnCells(p);
      }

      this.moveBlobs(dt);
      this.eatPellets();
      this.eatEjected();
      this.checkViruses();
      this.eatPlayers();
      this.decay(dt);

      // maintient la densité de nourriture
      while (this.pellets.size < C.PELLET_COUNT) this.spawnPellet();

      for (const p of this.players.values()) {
        if (!p.dead && p.cells.length === 0) {
          p.dead = true;
          p.respawnAt = this.time + 2000;
        }
        p.score = Math.max(p.score, Math.floor(this.playerMass(p)));
      }
    }

    moveCells(p, dt) {
      for (const cell of p.cells) {
        const dx = p.tx - cell.x, dy = p.ty - cell.y;
        const d = Math.hypot(dx, dy);
        const sp = Math.min(C.speed(cell.m), d / dt || 0); // ne dépasse pas la cible
        if (d > 1) {
          cell.x += (dx / d) * sp * dt;
          cell.y += (dy / d) * sp * dt;
        }
        // impulsion de split/explosion, amortie
        cell.x += cell.vx * dt;
        cell.y += cell.vy * dt;
        const damp = Math.pow(0.05, dt); // ~95 % perdu en 1 s
        cell.vx *= damp; cell.vy *= damp;
        cell.x = Math.max(0, Math.min(C.WORLD, cell.x));
        cell.y = Math.max(0, Math.min(C.WORLD, cell.y));
      }
    }

    resolveOwnCells(p) {
      const now = this.time;
      for (let i = 0; i < p.cells.length; i++) {
        for (let j = i + 1; j < p.cells.length; j++) {
          const a = p.cells[i], b = p.cells[j];
          const ra = C.radius(a.m), rb = C.radius(b.m);
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const canMerge = now >= a.mergeAt && now >= b.mergeAt;
          if (canMerge) {
            if (d < Math.max(ra, rb) * 0.6) { // fusion
              if (a.m >= b.m) { a.m += b.m; b.m = 0; } else { b.m += a.m; a.m = 0; }
            }
          } else if (d < ra + rb && d > 0.001) { // répulsion
            const overlap = (ra + rb - d) / 2;
            const nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
            a.x += nx * overlap; a.y += ny * overlap;
            b.x -= nx * overlap; b.y -= ny * overlap;
          }
        }
      }
      p.cells = p.cells.filter((c) => c.m > 0);
    }

    moveBlobs(dt) {
      // amortissement doux : portée d'un blob éjecté ~350 px
      const damp = Math.pow(0.1, dt);
      for (const e of this.ejected.values()) {
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.vx *= damp; e.vy *= damp;
        e.x = Math.max(0, Math.min(C.WORLD, e.x));
        e.y = Math.max(0, Math.min(C.WORLD, e.y));
      }
      for (const v of this.viruses.values()) {
        if (!v.vx && !v.vy) continue;
        v.x += v.vx * dt; v.y += v.vy * dt;
        v.vx *= damp; v.vy *= damp;
        if (Math.abs(v.vx) + Math.abs(v.vy) < 5) { v.vx = 0; v.vy = 0; }
        v.x = Math.max(0, Math.min(C.WORLD, v.x));
        v.y = Math.max(0, Math.min(C.WORLD, v.y));
      }
    }

    eatPellets() {
      for (const p of this.players.values()) {
        for (const cell of p.cells) {
          const r = C.radius(cell.m);
          const r2 = r * r;
          for (const pel of this.pellets.values()) {
            if (dist2(cell.x, cell.y, pel.x, pel.y) < r2) {
              cell.m += C.PELLET_MASS;
              this.removePellet(pel);
            }
          }
        }
      }
    }

    eatEjected() {
      for (const p of this.players.values()) {
        for (const cell of p.cells) {
          const r = C.radius(cell.m);
          for (const e of this.ejected.values()) {
            // petit délai avant que l'émetteur puisse ravaler son blob
            if (e.owner === p.id && this.time - e.born < 600) continue;
            if (dist2(cell.x, cell.y, e.x, e.y) < r * r) {
              cell.m += C.EJECT_MASS;
              this.ejected.delete(e.id);
            }
          }
        }
      }
    }

    checkViruses() {
      // les blobs éjectés nourrissent les virus : le virus gonfle visiblement,
      // puis se scinde au 7e blob en tirant un nouveau virus dans la
      // direction du dernier nourrissage
      for (const v of this.viruses.values()) {
        const rv = C.radius(v.m);
        for (const e of this.ejected.values()) {
          if (dist2(v.x, v.y, e.x, e.y) < rv * rv) {
            v.fed++;
            v.m += C.EJECT_MASS;
            v.lastFeedX = e.vx; v.lastFeedY = e.vy;
            this.ejected.delete(e.id);
            if (v.fed >= C.VIRUS_FEED_TO_SPLIT) {
              v.fed = 0;
              v.m = C.VIRUS_MASS;
              const d = Math.hypot(v.lastFeedX, v.lastFeedY) || 1;
              this.spawnVirus(v.x, v.y,
                (v.lastFeedX / d) * C.EJECT_SPEED, (v.lastFeedY / d) * C.EJECT_SPEED);
            }
          }
        }
      }
      // une grosse cellule qui recouvre un virus explose
      for (const p of this.players.values()) {
        for (const cell of p.cells.slice()) {
          if (cell.m < C.VIRUS_EXPLODE_MASS) continue;
          const r = C.radius(cell.m);
          for (const v of this.viruses.values()) {
            if (dist2(cell.x, cell.y, v.x, v.y) < r * r * 0.6) {
              cell.m += v.m * 0.5;
              this.viruses.delete(v.id);
              this.explodeCell(p, cell);
              if (this.viruses.size < C.VIRUS_COUNT) this.spawnVirus();
              break;
            }
          }
        }
      }
    }

    eatPlayers() {
      const players = [...this.players.values()].filter((p) => !p.dead);
      for (let i = 0; i < players.length; i++) {
        for (let j = 0; j < players.length; j++) {
          if (i === j) continue;
          const eater = players[i], prey = players[j];
          for (const a of eater.cells) {
            const ra = C.radius(a.m);
            for (const b of prey.cells) {
              if (b.m <= 0) continue;
              if (a.m < b.m * C.EAT_RATIO) continue;
              const rb = C.radius(b.m);
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              if (d < ra - rb * 0.4) { // le centre de la proie est bien recouvert
                a.m += b.m;
                b.m = 0;
              }
            }
          }
        }
      }
      for (const p of players) p.cells = p.cells.filter((c) => c.m > 0);
    }

    decay(dt) {
      for (const p of this.players.values()) {
        for (const cell of p.cells) {
          if (cell.m > C.START_MASS * 2) cell.m -= cell.m * C.DECAY_RATE * dt;
        }
      }
    }

    // ---- IA des bots ----

    botThink(bot) {
      if (this.time < bot.botNextThink) return;
      bot.botNextThink = this.time + rnd(150, 350);
      const me = bot.cells[0];
      if (!me) return;
      const myMass = this.playerMass(bot);
      const myR = C.radius(myMass);

      let threat = null, threatD = Infinity;
      let prey = null, preyD = Infinity;
      for (const other of this.players.values()) {
        if (other.id === bot.id || other.dead) continue;
        for (const c of other.cells) {
          const d = Math.hypot(c.x - me.x, c.y - me.y);
          if (c.m > myMass * C.EAT_RATIO && d < 550 + myR && d < threatD) {
            threat = c; threatD = d;
          }
          if (myMass > c.m * C.EAT_RATIO * 1.1 && d < 750 && d < preyD) {
            prey = c; preyD = d;
          }
        }
      }

      // 1) bombarder : une grosse cellule ennemie campe derrière un virus
      //    aligné → on nourrit le virus, qui finira par tirer un nouveau
      //    virus droit sur elle et la faire exploser
      for (const other of this.players.values()) {
        if (other.id === bot.id || other.dead) continue;
        for (const c of other.cells) {
          if (c.m < C.VIRUS_EXPLODE_MASS) continue;
          if (myMass > c.m * C.EAT_RATIO) continue; // mangeable : inutile de bombarder
          for (const v of this.viruses.values()) {
            // ne s'engage que s'il a la masse pour finir le nourrissage
            // (7 blobs moins ce que le virus a déjà avalé, marge incluse) —
            // plusieurs bots peuvent ainsi se relayer sur le même virus
            const needed = C.VIRUS_FEED_TO_SPLIT - v.fed;
            if (me.m < C.MIN_EJECT_MASS + C.EJECT_LOSS * (needed + 1)) continue;
            const dVE = Math.hypot(c.x - v.x, c.y - v.y);
            // portée du virus tiré (~356 px) + rayon de la cible
            if (dVE > 300 + C.radius(c.m)) continue;
            const dMV = Math.hypot(v.x - me.x, v.y - me.y);
            if (dMV < myR + 40 || dMV > myR + 320) continue; // portée d'éjection
            // l'ennemi doit être dans le prolongement moi → virus
            const ux = (v.x - me.x) / dMV, uy = (v.y - me.y) / dMV;
            const wx = (c.x - v.x) / dVE, wy = (c.y - v.y) / dVE;
            if (ux * wx + uy * wy < 0.75) continue;
            bot.tx = v.x; bot.ty = v.y;
            bot.wantEject = true;
            return;
          }
        }
      }

      // 2) fuir les menaces — vers un virus si on est assez petit pour
      //    s'y abriter (un gros poursuivant explosera dessus)
      if (threat) {
        if (myMass < C.VIRUS_EXPLODE_MASS) {
          let shelter = null, shelterD = Infinity;
          for (const v of this.viruses.values()) {
            const d = Math.hypot(v.x - me.x, v.y - me.y);
            // le virus doit être grosso modo à l'opposé de la menace
            const away = (v.x - me.x) * (me.x - threat.x) + (v.y - me.y) * (me.y - threat.y);
            if (d < 600 && away > 0 && d < shelterD) { shelter = v; shelterD = d; }
          }
          if (shelter) { bot.tx = shelter.x; bot.ty = shelter.y; return; }
        }
        // fuite consciente des murs : parmi 8 directions, choisir celle qui
        // éloigne le plus de la menace en restant dans le monde (fuir tout
        // droit vers un mur = se coincer dans le coin et se faire manger)
        let bestScore = -Infinity, bestX = me.x, bestY = me.y;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4;
          const nx = me.x + Math.cos(a) * 450;
          const ny = me.y + Math.sin(a) * 450;
          const cx = Math.max(myR, Math.min(C.WORLD - myR, nx));
          const cy = Math.max(myR, Math.min(C.WORLD - myR, ny));
          const score = Math.hypot(cx - threat.x, cy - threat.y)
            - Math.hypot(cx - nx, cy - ny) * 1.5; // pénalise la part hors monde
          if (score > bestScore) { bestScore = score; bestX = cx; bestY = cy; }
        }
        bot.tx = bestX; bot.ty = bestY;
        // acculé, menace au contact : split de fuite — la moitié propulsée
        // vers la sortie s'échappe, quitte à sacrifier l'autre
        if (bot.cells.length === 1 && me.m >= C.MIN_SPLIT_MASS * 2 &&
            threatD < C.radius(threat.m) + myR + 100) {
          bot.wantSplit = true;
        }
        return;
      }
      // 3) éviter les virus quand on est gros
      if (myMass >= C.VIRUS_EXPLODE_MASS) {
        for (const v of this.viruses.values()) {
          const d = Math.hypot(v.x - me.x, v.y - me.y);
          if (d < myR + 90) {
            bot.tx = me.x + (me.x - v.x) * 3;
            bot.ty = me.y + (me.y - v.y) * 3;
            return;
          }
        }
      }
      // 4) chasser une proie (split occasionnel si gros avantage)
      if (prey) {
        bot.tx = prey.x; bot.ty = prey.y;
        if (bot.cells.length === 1 && me.m > prey.m * 3 &&
            preyD < C.radius(me.m) * 3 && Math.random() < 0.25) {
          bot.wantSplit = true;
        }
        return;
      }
      // 5) sinon, la pastille la plus proche
      let best = null, bestD = Infinity;
      for (const pel of this.pellets.values()) {
        const d = dist2(pel.x, pel.y, me.x, me.y);
        if (d < bestD) { best = pel; bestD = d; }
      }
      if (best) { bot.tx = best.x; bot.ty = best.y; }
    }

    // ---- sérialisation pour le réseau / rendu ----

    leaderboard() {
      return [...this.players.values()]
        .filter((p) => !p.dead)
        .map((p) => ({ id: p.id, name: p.name, mass: Math.floor(this.playerMass(p)) }))
        .sort((a, b) => b.mass - a.mass)
        .slice(0, 10);
    }

    snapshot() {
      const players = [];
      for (const p of this.players.values()) {
        if (p.dead) continue;
        players.push({
          id: p.id, name: p.name, color: p.color,
          cells: p.cells.map((c) => ({
            id: c.id,
            x: Math.round(c.x), y: Math.round(c.y),
            m: Math.round(c.m * 10) / 10,
          })),
        });
      }
      // draine les diffs de nourriture : ils couvrent tout ce qui s'est
      // passé depuis le snapshot précédent
      const pa = this.pelletsAdded, pr = this.pelletsRemoved;
      this.pelletsAdded = [];
      this.pelletsRemoved = [];
      return {
        t: 'state',
        players,
        pa,
        pr,
        ej: [...this.ejected.values()].map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), c: e.c })),
        vi: [...this.viruses.values()].map((v) => ({ x: Math.round(v.x), y: Math.round(v.y), m: Math.round(v.m) })),
        lb: this.leaderboard(),
      };
    }

    fullPellets() {
      return [...this.pellets.values()];
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { World };
  else global.Sim = { World };
})(typeof window !== 'undefined' ? window : globalThis);
