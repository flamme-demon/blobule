// Réseau P2P via PeerJS (WebRTC). Aucun serveur de jeu : le navigateur de
// l'hôte exécute la simulation, les invités n'échangent que leurs entrées
// et reçoivent l'état. Le serveur public PeerJS ne sert qu'à la mise en
// relation initiale (signaling), aucune donnée de jeu n'y transite.
(function (global) {
  const C = global.CFG;

  function peerAvailable() { return typeof global.Peer !== 'undefined'; }

  // ---------- côté hôte ----------
  function createHost(world, opts, callbacks) {
    // opts: { maxPlayers } — callbacks: { onReady(id), onError(err), onPlayersChanged() }
    const host = {
      peer: null,
      conns: new Map(),        // peerId -> DataConnection
      botIds: [],
      inviteId: null,
      destroy() {
        clearInterval(host._timer);
        if (host.peer) host.peer.destroy();
      },
    };

    // remplit la partie avec des bots (noms mélangés, sans doublon)
    const names = C.BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    let nameIdx = 0;
    const nextName = () => names[nameIdx++ % names.length];
    const botCount = Math.max(0, opts.maxPlayers - 1);
    for (let i = 0; i < botCount; i++) {
      const id = 'bot-' + i;
      world.addPlayer(id, nextName(), true);
      host.botIds.push(id);
    }

    if (!peerAvailable()) {
      callbacks.onError(new Error('PeerJS indisponible (hors ligne ?) — partie locale uniquement.'));
      return host;
    }

    const peer = new global.Peer();
    host.peer = peer;

    peer.on('open', (id) => {
      host.inviteId = id;
      callbacks.onReady(id);
    });
    peer.on('error', (err) => callbacks.onError(err));

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        host.conns.set(conn.peer, conn);
        conn._lastSeen = Date.now();
      });
      conn.on('data', (msg) => {
        conn._lastSeen = Date.now();
        handleMessage(conn, msg);
      });
      conn.on('close', () => dropGuest(conn.peer));
      conn.on('error', () => dropGuest(conn.peer));
    });

    function handleMessage(conn, msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'join') {
        const humans = 1 + [...world.players.values()].filter((p) => !p.isBot && p.id !== 'me').length;
        if (humans >= opts.maxPlayers && host.botIds.length === 0) {
          conn.send({ t: 'full' });
          return;
        }
        // un humain remplace un bot
        const botId = host.botIds.pop();
        if (botId) world.removePlayer(botId);
        const name = String(msg.name || 'Invité').slice(0, 16);
        world.addPlayer(conn.peer, name, false);
        conn.send({
          t: 'init',
          you: conn.peer,
          world: C.WORLD,
          pellets: world.fullPellets(),
        });
        callbacks.onPlayersChanged();
      } else if (msg.t === 'input') {
        world.setInput(conn.peer, msg);
      } else if (msg.t === 'respawn') {
        const p = world.players.get(conn.peer);
        if (p && p.dead) world.respawn(p);
      }
    }

    function dropGuest(peerId) {
      if (!host.conns.has(peerId)) return;
      host.conns.delete(peerId);
      if (world.players.has(peerId)) {
        world.removePlayer(peerId);
        // un bot reprend le slot libéré
        const id = 'bot-r' + Math.floor(Math.random() * 1e6);
        world.addPlayer(id, nextName(), true);
        host.botIds.push(id);
        callbacks.onPlayersChanged();
      }
    }

    // diffusion de l'état + détection des invités silencieux (la fermeture
    // WebRTC peut mettre >10 s à être signalée ; les invités envoient leurs
    // entrées ~15 fois/s, donc 5 s de silence = parti)
    host._timer = setInterval(() => {
      if (host.conns.size === 0) return;
      const now = Date.now();
      for (const conn of [...host.conns.values()]) {
        if (now - conn._lastSeen > 5000) {
          try { conn.close(); } catch (_) { /* déjà fermée */ }
          dropGuest(conn.peer);
        }
      }
      const snap = world.snapshot();
      for (const conn of host.conns.values()) {
        if (conn.open) {
          try { conn.send(snap); } catch (_) { /* connexion en cours de fermeture */ }
        }
      }
    }, C.NET_MS);

    return host;
  }

  // ---------- côté invité ----------
  function joinGame(hostId, name, callbacks) {
    // callbacks: { onInit(msg), onState(msg), onFull(), onClose(), onError(err) }
    const client = {
      peer: null, conn: null, closed: false,
      sendInput(input) {
        if (client.conn && client.conn.open) {
          input.t = 'input';
          client.conn.send(input);
        }
      },
      requestRespawn() {
        if (client.conn && client.conn.open) client.conn.send({ t: 'respawn' });
      },
      destroy() {
        client.closed = true;
        if (client.peer) client.peer.destroy();
      },
    };

    if (!peerAvailable()) {
      callbacks.onError(new Error('PeerJS indisponible — vérifiez votre connexion.'));
      return client;
    }

    const peer = new global.Peer();
    client.peer = peer;
    peer.on('error', (err) => callbacks.onError(err));
    peer.on('open', () => {
      const conn = peer.connect(hostId, { reliable: true });
      client.conn = conn;
      conn.on('open', () => conn.send({ t: 'join', name }));
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'init') callbacks.onInit(msg);
        else if (msg.t === 'state') callbacks.onState(msg);
        else if (msg.t === 'full') callbacks.onFull();
      });
      conn.on('close', () => { if (!client.closed) callbacks.onClose(); });
      conn.on('error', (err) => callbacks.onError(err));
    });

    return client;
  }

  global.Net = { createHost, joinGame, peerAvailable };
})(window);
