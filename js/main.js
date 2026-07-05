// Orchestration : menu, boucle de jeu, entrées, HUD.
(function () {
  const C = window.CFG;
  const $ = (sel) => document.querySelector(sel);

  const canvas = $('#game');
  const renderer = Render.createRenderer(canvas);

  const ui = {
    menu: $('#menu'), menuMsg: $('#menuMsg'),
    name: $('#nameInput'), slots: $('#slotsInput'),
    hostBtn: $('#hostBtn'), joinInput: $('#joinInput'), joinBtn: $('#joinBtn'),
    hud: $('#hud'), leaderboard: $('#leaderboard'), massBar: $('#massBar'),
    inviteBar: $('#inviteBar'), inviteLink: $('#inviteLink'), copyBtn: $('#copyBtn'),
    quitBtn: $('#quitBtn'),
    death: $('#deathOverlay'), deathScore: $('#deathScore'),
    respawnBtn: $('#respawnBtn'), deathQuitBtn: $('#deathQuitBtn'),
  };

  // ---- état global de session ----
  let mode = null;          // 'host' | 'client' | null
  let world = null;         // mode hôte
  let hostNet = null;
  let clientNet = null;
  let myId = null;
  let running = false;
  let rafId = 0;

  const input = {
    mouseX: window.innerWidth / 2, mouseY: window.innerHeight / 2,
    split: false, eject: false, ejectHeld: false,
  };

  // état distant (mode invité)
  const remote = {
    pellets: new Map(),
    latest: null,           // dernier snapshot reçu
    cells: new Map(),       // cellId -> {x,y,m} interpolé
    wasAlive: false,
    lastScore: 0,
  };

  // ---- entrées ----
  window.addEventListener('mousemove', (e) => {
    input.mouseX = e.clientX; input.mouseY = e.clientY;
  });
  window.addEventListener('keydown', (e) => {
    if (!running || e.repeat) return;
    if (e.code === 'Space') { e.preventDefault(); input.split = true; }
    // e.key (et non e.code) pour respecter la disposition du clavier (AZERTY…)
    if (e.key.toLowerCase() === 'w') input.ejectHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'w') input.ejectHeld = false;
  });
  setInterval(() => { if (input.ejectHeld) input.eject = true; }, 100);

  // ---- menu ----
  const params = new URLSearchParams(location.search);
  if (params.get('join')) {
    ui.joinInput.value = params.get('join');
    ui.menuMsg.textContent = 'Invitation détectée — choisissez un pseudo puis cliquez sur Rejoindre.';
  }
  ui.name.value = localStorage.getItem('agar-name') || '';

  function playerName() {
    const n = ui.name.value.trim().slice(0, 16) || 'Anonyme';
    localStorage.setItem('agar-name', n);
    return n;
  }

  ui.hostBtn.addEventListener('click', startHost);
  ui.joinBtn.addEventListener('click', startJoin);
  ui.quitBtn.addEventListener('click', quitToMenu);
  ui.deathQuitBtn.addEventListener('click', quitToMenu);
  ui.respawnBtn.addEventListener('click', () => {
    ui.death.classList.add('hidden');
    if (mode === 'host') {
      const me = world.players.get(myId);
      if (me && me.dead) world.respawn(me);
    } else if (clientNet) {
      clientNet.requestRespawn();
    }
  });
  ui.copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(ui.inviteLink.value).then(() => {
      ui.copyBtn.textContent = 'Copié !';
      setTimeout(() => { ui.copyBtn.textContent = 'Copier'; }, 1500);
    });
  });

  function showMenu(msg) {
    ui.menu.classList.remove('hidden');
    ui.hud.classList.add('hidden');
    ui.death.classList.add('hidden');
    ui.inviteBar.classList.add('hidden');
    ui.menuMsg.textContent = msg || '';
  }

  function enterGame() {
    ui.menu.classList.add('hidden');
    ui.hud.classList.remove('hidden');
    ui.death.classList.add('hidden');
    running = true;
    lastFrame = performance.now();
    accumulator = 0;
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function quitToMenu() {
    running = false;
    if (hostNet) { hostNet.destroy(); hostNet = null; }
    if (clientNet) { clientNet.destroy(); clientNet = null; }
    world = null; mode = null; myId = null;
    remote.pellets.clear(); remote.cells.clear();
    remote.latest = null; remote.wasAlive = false;
    history.replaceState(null, '', location.pathname);
    showMenu('');
  }

  // ---- mode hôte (solo + bots + invités) ----
  function startHost() {
    mode = 'host';
    myId = 'me';
    world = new Sim.World();
    window.__world = world; // accès console pour déboguer / modder
    world.addPlayer(myId, playerName(), false);
    const maxPlayers = Math.max(1, Math.min(12, parseInt(ui.slots.value, 10) || 5));

    hostNet = Net.createHost(world, { maxPlayers }, {
      onReady(id) {
        const url = location.origin + location.pathname + '?join=' + id;
        ui.inviteLink.value = location.protocol === 'file:' ? id : url;
        ui.inviteBar.classList.remove('hidden');
        ui.inviteBar.title = location.protocol === 'file:'
          ? 'Page ouverte en local : partagez ce code, vos invités le collent dans « Rejoindre ».'
          : 'Partagez ce lien pour inviter des joueurs.';
      },
      onError() {
        ui.inviteBar.classList.add('hidden');
      },
      onPlayersChanged() {},
    });
    enterGame();
  }

  // ---- mode invité ----
  function startJoin() {
    let code = ui.joinInput.value.trim();
    if (!code) { ui.menuMsg.textContent = 'Collez un lien ou un code d’invitation.'; return; }
    try {
      const u = new URL(code);
      code = new URLSearchParams(u.search).get('join') || code;
    } catch (_) { /* ce n'était pas une URL : on garde le code brut */ }

    ui.menuMsg.textContent = 'Connexion à l’hôte…';
    mode = 'client';
    clientNet = Net.joinGame(code, playerName(), {
      onInit(msg) {
        myId = msg.you;
        remote.pellets.clear();
        for (const p of msg.pellets) remote.pellets.set(p.id, p);
        enterGame();
      },
      onState(msg) {
        for (const id of msg.pr) remote.pellets.delete(id);
        for (const p of msg.pa) remote.pellets.set(p.id, p);
        remote.latest = msg;
      },
      onFull() { quitToMenu(); ui.menuMsg.textContent = 'Partie pleine, désolé !'; },
      onClose() { quitToMenu(); ui.menuMsg.textContent = 'L’hôte a quitté la partie.'; },
      onError(err) {
        if (!running) {
          quitToMenu();
          ui.menuMsg.textContent = 'Connexion impossible : ' + (err.type || err.message);
        }
      },
    });
  }

  // ---- boucle de jeu ----
  let lastFrame = 0;
  let accumulator = 0;
  let netTimer = 0;
  let lbTimer = 0;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!running) return;
    const dtMs = Math.min(100, now - lastFrame);
    lastFrame = now;
    const dt = dtMs / 1000;

    let view, myCells;
    if (mode === 'host') {
      accumulator += dtMs;
      while (accumulator >= C.TICK_MS) {
        applyLocalInput();
        world.tick(C.TICK_MS);
        accumulator -= C.TICK_MS;
      }
      const me = world.players.get(myId);
      myCells = me && !me.dead ? me.cells : [];
      view = {
        players: [...world.players.values()].filter((p) => !p.dead),
        pellets: world.pellets.values(),
        ejected: world.ejected.values(),
        viruses: world.viruses.values(),
        lb: null,
      };
      checkDeath(me && me.dead, me ? me.score : 0);
      if (now - lbTimer > 500) { lbTimer = now; updateLeaderboard(world.leaderboard()); }
    } else {
      // invité : interpolation vers le dernier snapshot
      view = buildRemoteView(dt);
      myCells = view.myCells;
      netTimer += dtMs;
      if (netTimer >= C.NET_MS) {
        netTimer = 0;
        sendClientInput();
      }
      if (remote.latest && now - lbTimer > 500) {
        lbTimer = now;
        updateLeaderboard(remote.latest.lb);
      }
    }

    const cam = renderer.updateCamera(myCells, dt);
    void cam;
    renderer.draw(view, myId);

    const mass = myCells.reduce((s, c) => s + c.m, 0);
    ui.massBar.textContent = mass > 0 ? 'Masse : ' + Math.floor(mass) : '';
  }

  function applyLocalInput() {
    const t = renderer.worldFromScreen(input.mouseX, input.mouseY);
    world.setInput(myId, { tx: t.x, ty: t.y, split: input.split, eject: input.eject });
    input.split = false; input.eject = false;
  }

  function sendClientInput() {
    if (!clientNet) return;
    const t = renderer.worldFromScreen(input.mouseX, input.mouseY);
    clientNet.sendInput({ tx: t.x, ty: t.y, split: input.split, eject: input.eject });
    input.split = false; input.eject = false;
  }

  function buildRemoteView(dt) {
    const empty = { players: [], pellets: remote.pellets.values(), ejected: [], viruses: [], myCells: [] };
    const snap = remote.latest;
    if (!snap) return empty;

    const k = Math.min(1, dt * 10); // lissage
    const seen = new Set();
    const players = [];
    let myCells = [];
    for (const p of snap.players) {
      const cells = [];
      for (const c of p.cells) {
        seen.add(c.id);
        let s = remote.cells.get(c.id);
        if (!s) { s = { x: c.x, y: c.y, m: c.m }; remote.cells.set(c.id, s); }
        s.x += (c.x - s.x) * k;
        s.y += (c.y - s.y) * k;
        s.m += (c.m - s.m) * k;
        cells.push(s);
      }
      players.push({ id: p.id, name: p.name, color: p.color, cells });
      if (p.id === myId) myCells = cells;
    }
    for (const id of remote.cells.keys()) if (!seen.has(id)) remote.cells.delete(id);

    const alive = myCells.length > 0;
    if (alive) {
      remote.wasAlive = true;
      remote.lastScore = Math.max(remote.lastScore, Math.floor(myCells.reduce((s, c) => s + c.m, 0)));
    }
    checkDeath(remote.wasAlive && !alive, remote.lastScore);

    return {
      players,
      pellets: remote.pellets.values(),
      ejected: snap.ej,
      viruses: snap.vi,
      myCells,
    };
  }

  function checkDeath(isDead, score) {
    const shown = !ui.death.classList.contains('hidden');
    if (isDead && !shown) {
      ui.deathScore.textContent = 'Score final : ' + (score || 0);
      ui.death.classList.remove('hidden');
    } else if (!isDead && shown) {
      ui.death.classList.add('hidden');
    }
  }

  function updateLeaderboard(lb) {
    if (!lb) return;
    ui.leaderboard.innerHTML = '<h3>Classement</h3>' + lb.map((e, i) =>
      '<div class="lb-row' + (e.id === myId ? ' me' : '') + '">' +
      (i + 1) + '. ' + escapeHtml(e.name) + ' <span>' + e.mass + '</span></div>'
    ).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  showMenu('');
  rafId = requestAnimationFrame(frame);
})();
