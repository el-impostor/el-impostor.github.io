/* =========================================================
   SALA SIN CUENTA (versión web): conexión al servidor de salas
   (server/, Cloudflare Workers + Durable Objects) por WebSocket.
   Funciona con datos móviles y en redes con cortafuegos porque es una
   conexión web normal. Expone la misma interfaz que usa jam.js:
   join(name, {hub, token}) -> { emit, send, on, presence, onPeers, peers, onStatus, connected, leave }
   - send(topic, data) (solo jugadores): mensaje solo para el anfitrión, que lo recibe
     con on(topic) y peer = id del jugador. Sin conexión no se envía (devuelve false).
   - Se reconecta sola (esperas crecientes, latido cada 10 s) y al volver
     reenvía la presencia, así que un voto hecho sin conexión llega al volver.
   - onStatus(fn) avisa de { connected, hub }: si este móvil está conectado
     y, para los jugadores, si el anfitrión lo está.
   ========================================================= */
const RelayRoom = (() => {
  const base = () => String(window.IMPOSTOR_RELAY || '').replace(/\/+$/, '');
  const available = () => typeof WebSocket !== 'undefined' && /^wss?:\/\/./.test(base());
  const freeze = o => Object.freeze(o);
  const rid = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return 'c' + [...a].map(b => b.toString(16).padStart(2, '0')).join(''); };
  const MESSAGES = {
    not_found: 'No hay ninguna sala abierta con ese código.',
    full: 'La sala está llena.',
    expired: 'La sala ha caducado por falta de actividad.',
    replaced: 'La sala se ha abierto en otro móvil o pestaña.',
    closed: 'El anfitrión ha cerrado la sala.',
    id_taken: 'Ese código ya lo usa otra sala.',
    too_big: 'Un mensaje era demasiado grande.',
    bad_token: 'No se pudo abrir la sala.',
    upstream_error: 'No se pudo conectar con el servidor de salas.'
  };
  const err = code => ({ code, message: MESSAGES[code] || MESSAGES.upstream_error });

  function join(name, opts) {
    opts = opts || {};
    if (!available()) return Promise.reject({ code: 'not_granted', message: 'Esta versión no tiene servidor de salas configurado.' });
    const hub = !!opts.hub, myId = hub ? 'hub' : rid();
    return new Promise((resolve, reject) => {
      const topics = {}, peerFns = [], errFns = [], statusFns = [];
      let ws = null, myPresence = {}, list = freeze([]), open = false, hubOn = hub, closed = false, resolved = false;
      let tries = 0, retry = null, lastIn = 0;
      const status = () => freeze({ connected: open, hub: hubOn });
      const fireStatus = () => { const s = status(); statusFns.forEach(fn => { try { fn(s); } catch (e) {} }); };
      const send = m => { if (open && ws && ws.readyState === 1) { try { ws.send(JSON.stringify(m)); return true; } catch (e) {} } return false; };

      const api = freeze({
        name,
        emit: async (topic, data) => {
          if (!hub) return;
          (topics[topic] || []).forEach(fn => { try { fn({ topic, data, peer: 'hub', by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false }); } catch (e) {} });
          send({ t: 'emit', topic, data });
        },
        send: (topic, data) => !hub && send({ t: 'send', topic, data }),
        on: (topic, fn) => { (topics[topic] = topics[topic] || []).push(fn); return () => { topics[topic] = topics[topic].filter(f => f !== fn); }; },
        // sin conexión se guarda y se envía al reconectar
        presence: async patch => { for (const k in patch) { if (patch[k] === null) delete myPresence[k]; else myPresence[k] = patch[k]; } if (!hub) send({ t: 'pres', presence: myPresence }); },
        peers: () => list,
        onPeers: (fn, onErr) => { peerFns.push(fn); if (onErr) errFns.push(onErr); setTimeout(() => fn({ peers: list, joined: list, left: [], updated: [] }), 0); return () => {}; },
        onStatus: fn => { statusFns.push(fn); setTimeout(() => fn(status()), 0); return () => {}; },
        connected: () => open,
        leave: async () => { closed = true; clearTimeout(retry); clearInterval(beat); document.removeEventListener('visibilitychange', onVis); try { if (ws) ws.close(1000); } catch (e) {} }
      });

      function connect() {
        if (closed) return;
        clearTimeout(retry);
        const me = ws = new WebSocket(base() + '/sala/' + encodeURIComponent(name));
        me.onopen = () => { if (me === ws) me.send(JSON.stringify({ t: 'hello', role: hub ? 'hub' : 'client', token: opts.token, id: myId, presence: myPresence })); };
        me.onmessage = e => {
          if (me !== ws) return;
          lastIn = Date.now();
          if (e.data === 'pong') return;
          let m; try { m = JSON.parse(e.data); } catch (x) { return; }
          if (m && typeof m === 'object') handle(m);
        };
        me.onclose = () => { if (me === ws) dropped(); };
        me.onerror = () => {};
      }
      function handle(m) {
        if (m.t === 'welcome') {
          open = true; tries = 0; if (!hub) hubOn = !!m.hub;
          fireStatus();
          if (!resolved) { resolved = true; resolve(api); }
        } else if (m.t === 'error') fatal(m.code);
        else if (m.t === 'emit') (topics[m.topic] || []).forEach(fn => { try { fn({ topic: m.topic, data: m.data, peer: m.from || 'hub', by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false }); } catch (e) {} });
        else if (m.t === 'peers' && hub && Array.isArray(m.peers)) {
          list = freeze(m.peers.map(p => freeze({ peer: p.peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: freeze(p.presence || {}), updatedAt: Date.now() })));
          const change = { peers: list, joined: list.filter(p => (m.joined || []).includes(p.peer)), left: m.left || [], updated: [] };
          peerFns.forEach(fn => { try { fn(change); } catch (e) {} });
        } else if (m.t === 'hub' && !hub) { hubOn = !!m.on; fireStatus(); }
      }
      function fatal(code) {
        const wasOpen = resolved;
        closed = true; open = false; clearTimeout(retry); clearInterval(beat); document.removeEventListener('visibilitychange', onVis);
        try { if (ws) ws.close(1000); } catch (e) {}
        fireStatus();
        if (!wasOpen) { resolved = true; reject(err(code)); } else errFns.forEach(fn => { try { fn(err(code)); } catch (e) {} });
      }
      function dropped() {
        const was = open; open = false; ws = null;
        if (was) fireStatus();
        if (closed) return;
        retry = setTimeout(connect, Math.min(10000, 400 * Math.pow(2, tries++)));
      }
      // latido: si no llega nada en 25 s, la conexión está muerta aunque el navegador no lo sepa
      const beat = setInterval(() => {
        if (!ws || ws.readyState !== 1) return;
        if (Date.now() - lastIn > 25000) { try { ws.close(); } catch (e) {} dropped(); }
        else try { ws.send('ping'); } catch (e) {}
      }, 10000);
      // al volver a primer plano (móvil desbloqueado), reconectar ya en vez de esperar
      const onVis = () => {
        if (document.hidden || closed) return;
        if (!ws) { tries = 0; connect(); }
        else if (ws.readyState === 1) { try { ws.send('ping'); } catch (e) {} const at = Date.now(); setTimeout(() => { if (ws && lastIn < at) { try { ws.close(); } catch (e) {} dropped(); } }, 4000); }
      };
      document.addEventListener('visibilitychange', onVis);
      setTimeout(() => { if (!resolved) fatal('upstream_error'); }, 15000);
      connect();
    });
  }
  return { join, available };
})();
