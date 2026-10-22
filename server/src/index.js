/* =========================================================
   SERVIDOR DE SALAS (Cloudflare Workers + Durable Objects)
   Cada sala es un Durable Object que reenvía mensajes:
   - el anfitrión ("hub") emite temas (estado, tarjetas, clave de sala) a todos;
   - cada jugador ("client") publica su presencia, que solo recibe el anfitrión,
     y puede mandarle mensajes solo a él ("send"), p. ej. sus aportaciones;
   No entiende el juego: tarjetas, votos, pistas y estado viajan cifrados
   de extremo a extremo y aquí solo se ven bloques opacos.
   Además: guarda el último estado para quien entra o se reconecta, avisa
   de si el anfitrión está conectado, limita los jugadores y borra la sala
   tras un tiempo sin actividad.
   Estadísticas anónimas (Durable Object «Contador»): solo totales por día de
   salas creadas, partidas repartidas y móviles que reciben papel. Ni nombres,
   ni palabras, ni cookies. Se ven en /estadisticas.
   ========================================================= */
import { DurableObject } from 'cloudflare:workers';

const MAX_MSG = 300000;               // bytes por mensaje (el estado con imágenes puede rondar 200 KB)
const send = (ws, m) => { try { ws.send(JSON.stringify(m)); } catch (e) {} };

export class Sala extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ttl = Number(env.SALA_TTL_SECONDS || 43200) * 1000;   // 12 h sin actividad
    this.max = Number(env.MAX_JUGADORES || 30);
    this.pres = null;      // presencias de los jugadores (copia en memoria de storage 'pres')
    this.lastSt = null;    // último estado emitido por el anfitrión
    this.stSaved = 0;
    this.alarmAt = 0;
    // los latidos se contestan sin despertar a la sala
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch() {
    if (this.ctx.getWebSockets().length >= this.max + 6) return new Response('Sala llena', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({});
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---------- utilidades ---------- */
  info(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }
  hubs(except) { return this.ctx.getWebSockets().filter(w => w !== except && this.info(w).r === 'hub'); }
  clients(except) { return this.ctx.getWebSockets().filter(w => w !== except && this.info(w).r === 'client'); }
  async presences() { if (!this.pres) this.pres = (await this.ctx.storage.get('pres')) || {}; return this.pres; }
  async savePres() { await this.ctx.storage.put('pres', this.pres || {}); }
  async count(add) {
    try { await this.env.CONTADOR.get(this.env.CONTADOR.idFromName('global')).fetch('https://contador/sumar', { method: 'POST', body: JSON.stringify(add) }); } catch (e) {}
  }
  fail(ws, code) { send(ws, { t: 'error', code }); try { ws.close(4000, code); } catch (e) {} }
  async touch() {
    const now = Date.now();
    if (now > this.alarmAt - this.ttl * 0.75) { this.alarmAt = now + this.ttl; await this.ctx.storage.setAlarm(this.alarmAt); }
  }
  async toHub(joined = [], left = [], except) {
    const hubs = this.hubs(); if (!hubs.length) return;
    const pres = await this.presences();
    const peers = this.clients(except).map(w => { const id = this.info(w).id; return { peer: id, presence: pres[id] || {} }; });
    hubs.forEach(h => send(h, { t: 'peers', peers, joined, left }));
  }

  /* ---------- mensajes ---------- */
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    if (raw.length > MAX_MSG) return this.fail(ws, 'too_big');
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    await this.touch();
    if (m.t === 'hello') return this.hello(ws, m);
    const me = this.info(ws);
    if (m.t === 'pres' && me.r === 'client' && m.presence && typeof m.presence === 'object') {
      (await this.presences())[me.id] = m.presence; await this.savePres();
      return this.toHub();
    }
    // un jugador manda algo solo al anfitrión (p. ej. sus aportaciones, cifradas); no se guarda
    if (m.t === 'send' && me.r === 'client' && typeof m.topic === 'string') {
      const out = JSON.stringify({ t: 'emit', topic: m.topic, data: m.data, from: me.id });
      for (const h of this.hubs()) { try { h.send(out); } catch (e) {} }
      return;
    }
    if (m.t === 'emit' && me.r === 'hub' && typeof m.topic === 'string') {
      const out = JSON.stringify({ t: 'emit', topic: m.topic, data: m.data });
      for (const c of this.clients()) { try { c.send(out); } catch (e) {} }
      if (m.topic === 'bye') {   // el anfitrión cierra la sala: se borra y se echa a todos
        await this.ctx.storage.deleteAll(); this.pres = null; this.lastSt = null; this.alarmAt = 0;
        for (const w of this.ctx.getWebSockets()) this.fail(w, 'closed');
        return;
      }
      if (m.topic === 'card' && m.data && typeof m.data.gid === 'string' && typeof m.data.to === 'string') {
        const g = (await this.ctx.storage.get('gid')) || { id: '', to: [] };
        const add = {};
        if (g.id !== m.data.gid) { g.id = m.data.gid; g.to = []; add.partidas = 1; }
        if (!g.to.includes(m.data.to)) { g.to.push(m.data.to); add.jugadores = 1; }
        if (add.partidas || add.jugadores) { await this.ctx.storage.put('gid', g); await this.count(add); }
      }
      if (m.topic === 'st') {
        this.lastSt = m.data;
        if (Date.now() - this.stSaved > 10000) { this.stSaved = Date.now(); await this.ctx.storage.put('st', m.data); }
      }
    }
  }

  async hello(ws, m) {
    const tok = await this.ctx.storage.get('tok');
    if (m.role === 'hub') {
      // solo puede ser anfitrión quien tenga el token con el que se creó la sala
      if (typeof m.token !== 'string' || m.token.length < 16) return this.fail(ws, 'bad_token');
      if (tok && tok !== m.token) return this.fail(ws, 'id_taken');
      if (!tok) { await this.ctx.storage.put('tok', m.token); await this.count({ salas: 1 }); }
      for (const h of this.hubs(ws)) this.fail(h, 'replaced');   // el anfitrión vuelve desde otra conexión
      ws.serializeAttachment({ r: 'hub' });
      send(ws, { t: 'welcome', you: 'hub' });
      await this.toHub(this.clients().map(w => this.info(w).id));
      for (const c of this.clients()) send(c, { t: 'hub', on: true });
      return;
    }
    if (!tok) return this.fail(ws, 'not_found');
    const id = typeof m.id === 'string' && /^[a-z0-9]{6,32}$/.test(m.id) ? m.id : 'c' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const same = this.clients(ws).filter(w => this.info(w).id === id);
    if (this.clients(ws).length - same.length >= this.max) return this.fail(ws, 'full');
    ws.serializeAttachment({ r: 'client', id });
    same.forEach(w => this.fail(w, 'replaced'));                    // conexión anterior del mismo móvil
    if (m.presence && typeof m.presence === 'object') { (await this.presences())[id] = m.presence; await this.savePres(); }
    send(ws, { t: 'welcome', you: id, hub: this.hubs().length > 0 });
    const st = this.lastSt || await this.ctx.storage.get('st');
    if (st) send(ws, { t: 'emit', topic: 'st', data: st });
    await this.toHub([id]);
  }

  async webSocketClose(ws) { await this.gone(ws); try { ws.close(1000, 'adiós'); } catch (e) {} }
  async webSocketError(ws) { await this.gone(ws); }
  async gone(ws) {
    const me = this.info(ws);
    ws.serializeAttachment({});
    if (me.r === 'client' && !this.clients(ws).some(w => this.info(w).id === me.id)) {
      delete (await this.presences())[me.id]; await this.savePres();
      await this.toHub([], [me.id], ws);
    }
    if (me.r === 'hub' && !this.hubs(ws).length) {
      if (this.lastSt) await this.ctx.storage.put('st', this.lastSt);
      for (const c of this.clients(ws)) send(c, { t: 'hub', on: false });
    }
  }

  /* ---------- caducidad ---------- */
  async alarm() {
    for (const w of this.ctx.getWebSockets()) this.fail(w, 'expired');
    await this.ctx.storage.deleteAll();
    this.pres = null; this.lastSt = null; this.alarmAt = 0;
  }
}

const STATS = ['salas', 'partidas', 'jugadores'];
export class Contador extends DurableObject {
  async fetch(req) {
    if (req.method === 'POST') {
      let add = {}; try { add = await req.json(); } catch (e) {}
      const k = 'd:' + new Date().toISOString().slice(0, 10), cur = (await this.ctx.storage.get(k)) || {};
      for (const n of STATS) if (Number.isFinite(add[n]) && add[n] > 0 && add[n] <= 100) cur[n] = (cur[n] || 0) + add[n];
      await this.ctx.storage.put(k, cur);
      return new Response('ok');
    }
    const days = [...(await this.ctx.storage.list({ prefix: 'd:' }))].map(([k, v]) => Object.assign({ dia: k.slice(2) }, v)).sort((a, b) => a.dia < b.dia ? 1 : -1).slice(0, 400);
    return Response.json(days);
  }
}
const esc = x => String(x).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
async function statsPage(env, json) {
  const days = await (await env.CONTADOR.get(env.CONTADOR.idFromName('global')).fetch('https://contador/')).json();
  if (json) return Response.json(days);
  const total = n => days.reduce((s, d) => s + (d[n] || 0), 0), cell = (d, n) => `<td>${d[n] || 0}</td>`;
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>El Impostor · estadísticas</title>
<style>body{font-family:system-ui,sans-serif;margin:16px;background:#15121b;color:#eee}table{border-collapse:collapse;width:100%;max-width:520px}td,th{padding:6px 8px;border-bottom:1px solid #333;text-align:right}th:first-child,td:first-child{text-align:left}.k{font-size:2rem;font-weight:800}.g{display:flex;gap:24px;margin:16px 0}small{color:#aaa}</style>
<h1>El Impostor · uso</h1>
<div class="g"><div><div class="k">${total('salas')}</div>salas</div><div><div class="k">${total('partidas')}</div>partidas</div><div><div class="k">${total('jugadores')}</div>papeles repartidos</div></div>
<table><tr><th>Día (UTC)</th><th>Salas</th><th>Partidas</th><th>Papeles</th></tr>${days.slice(0, 60).map(d => `<tr><td>${esc(d.dia)}</td>${cell(d, 'salas')}${cell(d, 'partidas')}${cell(d, 'jugadores')}</tr>`).join('')}</table>
<p><small>Solo totales de la versión web con sala: sin nombres, palabras ni cookies. «Papeles» cuenta los móviles que reciben papel (sin el anfitrión). Las partidas de un solo móvil no pasan por el servidor y no se cuentan.</small></p>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/estadisticas') return statsPage(env, url.searchParams.get('formato') === 'json');
    const m = /^\/sala\/([a-z0-9-]{3,40})$/.exec(url.pathname);
    if (!m) return new Response('El Impostor · servidor de salas', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Hace falta WebSocket', { status: 426 });
    // ORIGENES: lista separada por comas de webs que pueden usar el servidor (vacía o «*» = cualquiera; «*» lo usan las pruebas en local)
    const allowed = String(env.ORIGENES || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    if (allowed.length && !allowed.includes('*') && !allowed.includes(origin)) return new Response('Origen no permitido', { status: 403 });
    return env.SALAS.get(env.SALAS.idFromName(m[1])).fetch(req);
  }
};
