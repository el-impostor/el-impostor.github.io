/* =========================================================
   SALA SIN CUENTA (versión web): conexión directa entre móviles con PeerJS.
   El móvil del anfitrión hace de centro: los jugadores se conectan a él y
   él reenvía el estado. Expone la misma interfaz que usa jam.js:
   join(name, {hub}) -> { emit, on, presence, onPeers, peers, leave }
   ========================================================= */
const PeerRoom = (() => {
  const PREFIX = 'elimpostor-v1-';
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] };
  const available = () => typeof Peer !== 'undefined';
  const freeze = o => Object.freeze(o);

  function join(name, opts) {
    if (!available()) return Promise.reject({ code: 'not_granted', message: 'No se pudo cargar la conexión entre móviles. Revisa tu conexión a internet.' });
    return (opts && opts.hub) ? hub(name) : client(name);
  }

  /* ---------- anfitrión (centro) ---------- */
  function hub(name) {
    return new Promise((resolve, reject) => {
      const myId = PREFIX + name;
      const topics = {}, peerFns = [], errFns = [];
      const conns = new Map();            // peerId -> { conn, presence }
      let myPresence = {}, list = freeze([]), opened = false, closed = false;
      const peer = new Peer(myId, { debug: 0, config: ICE });

      function snapshot(forId) {
        const arr = [{ peer: myId, presence: myPresence }];
        conns.forEach((c, id) => arr.push({ peer: id, presence: c.presence }));
        return arr.map(p => freeze({ peer: p.peer, by: null, isMe: p.peer === forId, sameTab: p.peer === forId, kind: 'viewer', guest: false, presence: freeze(Object.assign({}, p.presence)), updatedAt: Date.now() }));
      }
      function publish(joinedIds) {
        list = freeze(snapshot(myId));
        const change = { peers: list, joined: list.filter(p => joinedIds.includes(p.peer)), left: [], updated: [] };
        peerFns.forEach(fn => { try { fn(change); } catch (e) {} });
        const raw = snapshot(null).map(p => ({ peer: p.peer, presence: p.presence }));
        conns.forEach((c) => { if (c.conn.open) try { c.conn.send({ t: 'peers', peers: raw, joined: joinedIds }); } catch (e) {} });
      }
      peer.on('open', () => {
        opened = true;
        resolve(freeze({
          name,
          emit: async (topic, data) => {
            (topics[topic] || []).forEach(fn => { try { fn({ topic, data, peer: myId, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false }); } catch (e) {} });
            conns.forEach(c => { if (c.conn.open) try { c.conn.send({ t: 'emit', topic, data, from: myId }); } catch (e) {} });
          },
          on: (topic, fn) => { (topics[topic] = topics[topic] || []).push(fn); return () => { topics[topic] = topics[topic].filter(f => f !== fn); }; },
          presence: async patch => { for (const k in patch) { if (patch[k] === null) delete myPresence[k]; else myPresence[k] = patch[k]; } publish([]); },
          peers: () => list,
          onPeers: (fn, onErr) => { peerFns.push(fn); if (onErr) errFns.push(onErr); setTimeout(() => fn({ peers: list, joined: list, left: [], updated: [] }), 0); return () => {}; },
          connected: () => !peer.disconnected && !closed,
          leave: async () => { closed = true; conns.forEach(c => { try { c.conn.close(); } catch (e) {} }); try { peer.destroy(); } catch (e) {} }
        }));
      });
      peer.on('connection', conn => {
        conn.on('open', () => { conns.set(conn.peer, { conn, presence: {} }); publish([conn.peer]); });
        conn.on('data', m => {
          if (!m || typeof m !== 'object') return;
          const c = conns.get(conn.peer); if (!c) return;
          if (m.t === 'pres' && m.presence && typeof m.presence === 'object') { c.presence = m.presence; publish([]); }
        });
        const drop = () => { if (conns.get(conn.peer) && conns.get(conn.peer).conn === conn) { conns.delete(conn.peer); publish([]); } };
        conn.on('close', drop); conn.on('error', drop);
      });
      peer.on('disconnected', () => { if (!closed) setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 1500); });
      peer.on('error', err => {
        const code = err && err.type === 'unavailable-id' ? 'id_taken' : 'upstream_error';
        if (!opened) reject({ code, message: String(err && err.type) });
        else if (err && err.type !== 'peer-unavailable') errFns.forEach(fn => { try { fn({ code, message: String(err.type) }); } catch (e) {} });
      });
      setTimeout(() => { if (!opened) { try { peer.destroy(); } catch (e) {} reject({ code: 'upstream_error', message: 'timeout' }); } }, 15000);
    });
  }

  /* ---------- jugador ---------- */
  function client(name) {
    return new Promise((resolve, reject) => {
      const hubId = PREFIX + name;
      const topics = {}, peerFns = [], errFns = [];
      let myPresence = {}, list = freeze([]), conn = null, myId = null, closed = false, resolved = false, retry = null, everOpen = false;
      const peer = new Peer({ debug: 0, config: ICE });

      const api = freeze({
        name,
        emit: async () => {},
        on: (topic, fn) => { (topics[topic] = topics[topic] || []).push(fn); return () => { topics[topic] = topics[topic].filter(f => f !== fn); }; },
        presence: async patch => {
          for (const k in patch) { if (patch[k] === null) delete myPresence[k]; else myPresence[k] = patch[k]; }
          if (conn && conn.open) conn.send({ t: 'pres', presence: myPresence });
        },
        peers: () => list,
        onPeers: (fn, onErr) => { peerFns.push(fn); if (onErr) errFns.push(onErr); setTimeout(() => fn({ peers: list, joined: list, left: [], updated: [] }), 0); return () => {}; },
        connected: () => !!(conn && conn.open),
        leave: async () => { closed = true; clearTimeout(retry); try { if (conn) conn.close(); } catch (e) {} try { peer.destroy(); } catch (e) {} }
      });
      function connect() {
        if (closed) return;
        clearTimeout(retry);
        const c = peer.connect(hubId, { reliable: true });
        let ok = false;
        c.on('open', () => {
          ok = true; everOpen = true; conn = c;
          c.send({ t: 'pres', presence: myPresence });
          if (!resolved) { resolved = true; resolve(api); }
        });
        c.on('data', m => {
          if (!m || typeof m !== 'object') return;
          if (m.t === 'emit') (topics[m.topic] || []).forEach(fn => { try { fn({ topic: m.topic, data: m.data, peer: m.from, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false }); } catch (e) {} });
          if (m.t === 'peers' && Array.isArray(m.peers)) {
            list = freeze(m.peers.map(p => freeze({ peer: p.peer, by: null, isMe: p.peer === myId, sameTab: p.peer === myId, kind: 'viewer', guest: false, presence: freeze(p.presence || {}), updatedAt: Date.now() })));
            const change = { peers: list, joined: list.filter(p => (m.joined || []).includes(p.peer)), left: [], updated: [] };
            peerFns.forEach(fn => { try { fn(change); } catch (e) {} });
          }
        });
        const lost = () => { if (conn === c) conn = null; if (!closed) retry = setTimeout(connect, 2000); };
        c.on('close', lost); c.on('error', lost);
        setTimeout(() => { if (!ok && !closed && conn !== c) { try { c.close(); } catch (e) {} retry = setTimeout(connect, 1500); } }, 8000);
      }
      peer.on('open', id => { myId = id; connect(); });
      peer.on('disconnected', () => { if (!closed) setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) {} }, 1500); });
      peer.on('error', err => {
        if (err && err.type === 'peer-unavailable') { if (!closed) retry = setTimeout(connect, 2500); return; }
        if (!resolved) { resolved = true; try { peer.destroy(); } catch (e) {} reject({ code: 'upstream_error', message: String(err && err.type) }); }
      });
      setTimeout(() => { if (!resolved) { resolved = true; closed = true; try { peer.destroy(); } catch (e) {} reject({ code: 'not_found', message: 'timeout' }); } }, 20000);
    });
  }
  return { join, available };
})();
