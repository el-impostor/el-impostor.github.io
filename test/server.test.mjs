/* Pruebas del servidor de salas (server/) contra `wrangler dev` en local.
   Uso: node test/server.test.mjs   (arranca y para el servidor solo; no necesita cuenta) */
import assert from 'node:assert';
import { startRelay } from './relay-dev.mjs';

const TTL = 4;   // segundos sin actividad hasta que la sala caduca (en producción, 12 h)
const relay = await startRelay({ SALA_TTL_SECONDS: TTL, MAX_JUGADORES: 3 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { failed++; console.error('FALLA:', name, '\n ', e.message); } };

/* cliente de prueba: guarda lo que recibe y permite esperar un mensaje concreto */
function conn(room) {
  const ws = new WebSocket(relay.url + '/sala/' + room), got = [];
  const waiters = [];
  ws.onmessage = e => {
    const m = e.data === 'pong' ? { t: 'pong' } : JSON.parse(e.data);
    got.push(m); waiters.slice().forEach(w => { if (w.f(m)) { waiters.splice(waiters.indexOf(w), 1); w.r(m); } });
  };
  const c = {
    ws, got,
    open: () => new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('no conecta')); }),
    send: m => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    wait: (f, ms = 3000) => new Promise((r, j) => {
      const hit = got.find(f); if (hit) return r(hit);
      const w = { f, r }; waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); j(new Error('no llegó el mensaje esperado; llegaron ' + JSON.stringify(got).slice(0, 300))); } }, ms);
    }),
    closed: () => new Promise(r => { if (ws.readyState === 3) r(); else ws.addEventListener('close', r); }),
    close: () => ws.close()
  };
  return c;
}
async function hub(room, token = 'token-del-anfitrion-123') { const h = conn(room); await h.open(); h.send({ t: 'hello', role: 'hub', token }); await h.wait(m => m.t === 'welcome' || m.t === 'error'); return h; }
async function client(room, id, presence = {}) { const c = conn(room); await c.open(); c.send({ t: 'hello', role: 'client', id, presence }); await c.wait(m => m.t === 'welcome' || m.t === 'error'); return c; }
const room = () => 'imp-t' + Math.random().toString(36).slice(2, 8);

try {
  await t('no se puede entrar en una sala que no existe', async () => {
    const c = await client(room(), 'jugador01');
    assert.strictEqual(c.got[0].code, 'not_found'); await c.closed();
  });

  await t('código ocupado por otro anfitrión', async () => {
    const r = room(), h = await hub(r);
    assert.strictEqual(h.got[0].t, 'welcome');
    const h2 = await hub(r, 'otro-token-distinto-456');
    assert.strictEqual(h2.got[0].code, 'id_taken');
    h.close();
  });

  await t('reenvía estado, presencias y último estado a quien entra tarde', async () => {
    const r = room(), h = await hub(r);
    const a = await client(r, 'jugadora01', { n: 'Ana' });
    assert.strictEqual(a.got[0].hub, true, 'sabe que el anfitrión está');
    const p = await h.wait(m => m.t === 'peers' && m.joined.includes('jugadora01'));
    assert.strictEqual(p.peers.find(x => x.peer === 'jugadora01').presence.n, 'Ana', 'la presencia llega con la entrada');
    h.send({ t: 'emit', topic: 'st', data: { enc: 'xyz', seq: 1 } });
    await a.wait(m => m.t === 'emit' && m.topic === 'st' && m.data.seq === 1);
    a.send({ t: 'pres', presence: { n: 'Ana', ready: 'g1' } });
    await h.wait(m => m.t === 'peers' && m.peers.some(x => x.presence.ready === 'g1'));
    const late = await client(r, 'tardon0001');
    await late.wait(m => m.t === 'emit' && m.topic === 'st' && m.data.seq === 1);
    h.close(); a.close(); late.close();
  });

  await t('el anfitrión se va y vuelve: avisos y presencias guardadas', async () => {
    const r = room(), h = await hub(r), a = await client(r, 'jugadora02', { n: 'Bea' });
    h.close(); await a.wait(m => m.t === 'hub' && m.on === false);
    a.send({ t: 'pres', presence: { n: 'Bea', vote: { k: 'g1.1.0', b: 'cifrado' } } });   // vota con el anfitrión fuera
    await sleep(200);
    const h2 = await hub(r);
    assert.strictEqual(h2.got[0].t, 'welcome', 'vuelve con su token');
    const p = await h2.wait(m => m.t === 'peers');
    assert.deepStrictEqual(p.joined, ['jugadora02'], 'al volver ve a todos como recién llegados');
    assert.strictEqual(p.peers[0].presence.vote.b, 'cifrado', 'el voto hecho en su ausencia le llega');
    await a.wait(m => m.t === 'hub' && m.on === true);
    h2.close(); a.close();
  });

  await t('límite de jugadores', async () => {
    const r = room(), h = await hub(r), cs = [];
    for (let i = 0; i < 3; i++) cs.push(await client(r, 'jugador1' + i));
    cs.forEach(c => assert.strictEqual(c.got[0].t, 'welcome'));
    const extra = await client(r, 'jugador19');
    assert.strictEqual(extra.got[0].code, 'full');
    const again = await client(r, 'jugador10');                 // el mismo móvil reconectando sí entra
    assert.strictEqual(again.got[0].t, 'welcome');
    await cs[0].wait(m => m.t === 'error' && m.code === 'replaced');
    h.close(); cs.forEach(c => c.close()); again.close();
  });

  await t('una conexión vieja del mismo jugador no borra su presencia', async () => {
    const r = room(), h = await hub(r);
    const a1 = await client(r, 'jugadora03', { n: 'Eva' });
    const a2 = await client(r, 'jugadora03', { n: 'Eva' });
    await a1.closed(); await sleep(200);
    h.send({ t: 'emit', topic: 'x', data: 1 }); await sleep(100);
    const last = h.got.filter(m => m.t === 'peers').pop();
    assert(last.peers.some(p => p.peer === 'jugadora03' && p.presence.n === 'Eva'), 'sigue en la sala');
    h.close(); a2.close();
  });

  await t('un jugador manda un mensaje solo al anfitrión', async () => {
    const r = room(), h = await hub(r), a = await client(r, 'jugadora06'), b = await client(r, 'jugadora07');
    a.send({ t: 'send', topic: 'ap', data: { part: 0, of: 1, chunk: 'cifrado' } });
    const m = await h.wait(x => x.t === 'emit' && x.topic === 'ap');
    assert.strictEqual(m.from, 'jugadora06', 'el anfitrión sabe de quién es');
    assert.strictEqual(m.data.chunk, 'cifrado');
    await sleep(200);
    assert(!b.got.some(x => x.topic === 'ap'), 'los demás jugadores no lo reciben');
    h.send({ t: 'send', topic: 'ap', data: {} });   // el anfitrión no usa este canal
    await sleep(200);
    assert(!a.got.some(x => x.topic === 'ap'));
    h.close(); a.close(); b.close();
  });

  await t('el anfitrión cierra la sala: avisa y el código deja de valer', async () => {
    const r = room(), h = await hub(r), a = await client(r, 'jugadora04');
    h.send({ t: 'emit', topic: 'bye', data: { c: 'x' } });
    await a.wait(m => m.t === 'error' && m.code === 'closed');
    const late = await client(r, 'jugadora05');
    assert.strictEqual(late.got[0].code, 'not_found');
  });

  await t('estadísticas anónimas: salas, partidas y papeles', async () => {
    const stats = async () => (await (await fetch(relay.url.replace('ws', 'http') + '/estadisticas?formato=json')).json())
      .reduce((s, d) => ({ salas: s.salas + (d.salas || 0), partidas: s.partidas + (d.partidas || 0), jugadores: s.jugadores + (d.jugadores || 0) }), { salas: 0, partidas: 0, jugadores: 0 });
    const before = await stats();
    const r = room(), h = await hub(r);
    for (const [gid, to] of [['g1', 'p1'], ['g1', 'p2'], ['g1', 'p1'], ['g2', 'p1']]) h.send({ t: 'emit', topic: 'card', data: { to, gid, iv: 'x', ct: 'y' } });
    h.close(); await sleep(500);
    const h2 = await hub(r); h2.close(); await sleep(300);   // volver a la misma sala no cuenta como nueva
    const after = await stats();
    assert.deepStrictEqual({ salas: after.salas - before.salas, partidas: after.partidas - before.partidas, jugadores: after.jugadores - before.jugadores }, { salas: 1, partidas: 2, jugadores: 3 });
    const page = await (await fetch(relay.url.replace('ws', 'http') + '/estadisticas')).text();
    assert(page.includes('papeles repartidos') && page.includes('noindex'), 'página legible');
  });

  await t('latido: ping → pong', async () => {
    const r = room(), h = await hub(r); h.send('ping'); await h.wait(m => m.t === 'pong'); h.close();
  });

  await t('mensajes demasiado grandes se rechazan', async () => {
    const r = room(), h = await hub(r);
    h.send({ t: 'emit', topic: 'st', data: 'x'.repeat(310000) });
    await h.wait(m => m.t === 'error' && m.code === 'too_big');
  });

  await t('la sala caduca tras un rato sin actividad', async () => {
    const r = room(), h = await hub(r);
    await h.wait(m => m.t === 'error' && m.code === 'expired', (TTL + 4) * 1000);
    const c = await client(r, 'jugador99');
    assert.strictEqual(c.got[0].code, 'not_found', 'el código ya no vale');
  });
} finally {
  await relay.stop();
}
console.log(`servidor: ${passed} pruebas superadas${failed ? `, ${failed} fallan` : ''}`);
process.exitCode = failed ? 1 : 0;
