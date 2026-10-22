const assert = require('assert');
const R = require('../src/rules.js');
const { WORDS } = require('../src/words.js');

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FALLA:', name, '\n ', e.message); process.exitCode = 1; } };

const cat = R.buildCatalog(WORDS, {});
const allIds = cat.map(c => c.id);
const cfg = (mode, extra = {}, players = ['Ana', 'Bea', 'Carlos', 'Dani', 'Eva', 'Fran']) =>
  ({ mode, players, cats: extra.cats || allIds, rules: Object.assign(R.rulesForMode(mode), extra.rules || {}) });

t('catálogo: sin claves duplicadas dentro de una categoría', () => {
  for (const c of cat) {
    const keys = c.words.map(w => w.key);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.strictEqual(dup.length, 0, c.id + ' duplicadas: ' + dup.join(', '));
  }
});

t('catálogo: datos suficientes', () => {
  const total = cat.reduce((s, c) => s + c.words.length, 0);
  assert(cat.length >= 21, 'categorías ' + cat.length);
  assert(total >= 500, 'palabras ' + total);
  cat.forEach(c => assert(c.words.length >= 20, c.id + ' tiene ' + c.words.length));
});

t('reparto: siempre exactamente k impostores', () => {
  for (let n = 3; n <= 20; n++) for (let k = 1; k * 2 < n; k++) for (let rep = 0; rep < 30; rep++) {
    const roles = R.assignRoles(n, k);
    assert.strictEqual(roles.filter(r => r === 'impostor').length, k);
    assert.strictEqual(roles.length, n);
  }
});

t('reparto: distribución aleatoria razonable', () => {
  const counts = Array(5).fill(0), N = 20000;
  for (let i = 0; i < N; i++) counts[R.assignRoles(5, 1).indexOf('impostor')]++;
  counts.forEach(c => assert(Math.abs(c / N - 0.2) < 0.02, 'sesgo ' + counts));
});

t('validación: casos límite', () => {
  const pool = R.buildPool(cat, cfg('clasico'));
  assert(!R.validate(cfg('clasico', {}, ['A', 'B']), pool).ok, '2 jugadores');
  assert(R.validate(cfg('clasico', {}, ['A', 'B', 'C']), pool).ok, '3 jugadores');
  assert(!R.validate(cfg('clasico', { rules: { impostors: 2 } }, ['A', 'B', 'C', 'D']), pool).ok, '2 imp en 4');
  assert(R.validate(cfg('clasico', { rules: { impostors: 2 } }, ['A', 'B', 'C', 'D', 'E']), pool).ok, '2 imp en 5');
  assert(!R.validate(cfg('clasico', {}, ['Ana', 'ana', 'C']), pool).ok, 'nombres duplicados');
  assert(!R.validate(cfg('clasico', { cats: [] }), pool).ok, 'sin categorías');
  assert(!R.validate(cfg('clasico', { rules: { impostors: 2, maxRounds: 1 } }), pool).ok, 'rondas < impostores');
  const empty = R.buildPool(cat, cfg('clasico', { cats: ['infantil'], rules: { difficulty: 'hard' } }));
  assert.strictEqual(empty.total, 0);
  assert(!R.validate(cfg('clasico', { cats: ['infantil'], rules: { difficulty: 'hard' } }), empty).ok, 'pool vacío');
  assert(!R.validate(cfg('varios', { rules: { impostors: 1 } }), pool).ok, 'modo varios con 1');
});

t('aviso de pocas palabras', () => {
  const st = { custom: [{ id: 'c1', name: 'Mini', words: [{ id: 'a', w: 'uno' }, { id: 'b', w: 'dos' }] }] };
  const c2 = R.buildCatalog(WORDS, st);
  const c = { mode: 'clasico', players: ['A', 'B', 'C'], cats: ['c1'], rules: R.rulesForMode('clasico') };
  const p = R.buildPool(c2, c);
  const v = R.validate(c, p);
  assert(v.ok && v.warnings.some(w => w.includes('Solo hay 2')), JSON.stringify(v));
});

t('palabras personalizadas, desactivadas, favoritas y subcategorías', () => {
  const st = {
    added: { animales: [{ id: 'x', w: 'ornitorrinco', sim: 'castor' }] },
    wordState: { [R.keyOf('animales', 'perro')]: { off: true }, [R.keyOf('animales', 'gato')]: { fav: true } },
    subOff: { 'futbol/jugadores': true }
  };
  const c2 = R.buildCatalog(WORDS, st);
  const base = { mode: 'clasico', players: ['A', 'B', 'C'], cats: ['animales'], rules: R.rulesForMode('clasico') };
  const p = R.buildPool(c2, base).pool.map(x => x.w);
  assert(p.includes('ornitorrinco') && !p.includes('perro'));
  const noCustom = R.buildPool(c2, Object.assign({}, base, { rules: Object.assign({}, base.rules, { useCustom: false }) })).pool.map(x => x.w);
  assert(!noCustom.includes('ornitorrinco'));
  const fav = R.buildPool(c2, Object.assign({}, base, { rules: Object.assign({}, base.rules, { favOnly: true }) })).pool.map(x => x.w);
  assert.deepStrictEqual(fav, ['gato']);
  const fut = R.buildPool(c2, Object.assign({}, base, { cats: ['futbol'] })).pool;
  assert(fut.length && fut.every(x => x.sub !== 'jugadores'));
});

t('evitar repeticiones y reciclar al agotarse', () => {
  const st = { custom: [{ id: 'c1', name: 'Mini', words: [{ id: 'a', w: 'uno' }, { id: 'b', w: 'dos' }] }] };
  const c2 = R.buildCatalog(WORDS, st);
  const c = { mode: 'clasico', players: ['A', 'B', 'C'], cats: ['c1'], rules: R.rulesForMode('clasico') };
  const p1 = R.buildPool(c2, c, [R.keyOf('c1', 'uno')]);
  assert.deepStrictEqual(p1.pool.map(x => x.w), ['dos']);
  const p2 = R.buildPool(c2, c, [R.keyOf('c1', 'uno'), R.keyOf('c1', 'dos')]);
  assert(p2.recycled && p2.pool.length === 2);
});

t('tarjetas: cada modo da la información correcta', () => {
  for (const m of R.MODES) {
    const c = cfg(m.id);
    const pool = R.buildPool(cat, c).pool;
    for (let rep = 0; rep < 40; rep++) {
      const g = R.createGame(c, pool);
      const imps = g.players.filter(p => p.role === 'impostor').length;
      assert.strictEqual(imps, g.rules.impostors, m.id);
      g.players.forEach((p, i) => {
        const card = R.cardFor(g, i);
        if (p.role === 'crew') { assert.strictEqual(card.word, g.secret.w); assert.strictEqual(card.kind, 'crew'); }
        else {
          const info = c.rules.impostorInfo;
          if (info === 'none') { assert.strictEqual(card.word, ''); assert.strictEqual(card.kind, 'impostor'); }
          if (info === 'category') { assert.strictEqual(card.word, ''); assert.strictEqual(card.category, g.secret.catName); }
          if (info === 'similar') { assert(card.word && R.norm(card.word) !== R.norm(g.secret.w), 'parecida igual ' + card.word); assert.strictEqual(card.kind, 'impostor'); }
          if (info === 'unaware') { assert(card.word && R.norm(card.word) !== R.norm(g.secret.w)); assert.strictEqual(card.kind, 'crew', 'infiltrado no debe saberlo'); }
          if (m.id === 'ciegas') assert.strictEqual(card.category, '');
          if (m.id === 'varios') assert.strictEqual(card.mates.length, c.rules.impostors - 1);
        }
        if (m.id === 'ciegas') assert.strictEqual(card.category, '');
      });
    }
  }
});

t('turnos: solo jugadores vivos, sin repetir', () => {
  const c = cfg('clasico'); const g = R.createGame(c, R.buildPool(cat, c).pool);
  g.players[2].alive = false;
  const o = R.turnOrder(g);
  assert.strictEqual(o.length, 5); assert(!o.includes(2)); assert.strictEqual(new Set(o).size, 5);
  const q = o.map((_, t) => R.questionTarget(g, o, t));
  q.forEach((x, t) => assert.notStrictEqual(x, o[t]));
});

t('recuento de votos y empates', () => {
  assert.strictEqual(R.tally([1, 1, 2], 'revote').eliminated, 1);
  const tie = R.tally([1, 2, -1], 'revote'); assert(tie.revote && tie.eliminated === null);
  assert(R.tally([1, 2], 'none').eliminated === null);
  assert([1, 2].includes(R.tally([1, 2], 'random').eliminated));
  assert.strictEqual(R.tally([-1, -1], 'revote').eliminated, null);
});

t('victoria: normales, impostores por número, por rondas y por adivinar', () => {
  const c = cfg('clasico'); const pool = R.buildPool(cat, c).pool;
  let g = R.createGame(c, pool);
  const imp = g.players.findIndex(p => p.role === 'impostor');
  R.eliminate(g, imp); assert.strictEqual(R.checkWin(g).winner, 'crew');

  g = R.createGame(c, pool); // 6 jugadores, 1 impostor: hay que eliminar 4 normales
  const crew = g.players.map((p, i) => p.role === 'crew' ? i : -1).filter(i => i >= 0);
  R.eliminate(g, crew[0]); assert.strictEqual(R.checkWin(g), null);
  R.eliminate(g, crew[1]); R.eliminate(g, crew[2]); assert.strictEqual(R.checkWin(g), null);
  R.eliminate(g, crew[3]); assert.strictEqual(R.checkWin(g).winner, 'impostors');

  const c1 = cfg('clasico', { rules: { maxRounds: 1 } });
  g = R.createGame(c1, pool); R.eliminate(g, g.players.findIndex(p => p.role === 'crew'));
  assert.strictEqual(R.checkWin(g).reason, 'survived');

  const c3 = cfg('adivina');
  g = R.createGame(c3, pool); const i3 = g.players.findIndex(p => p.role === 'impostor');
  R.eliminate(g, i3); assert(R.guessMatches(g, g.secret.w.toUpperCase()));
  R.applyGuess(g, i3, true); assert.strictEqual(R.checkWin(g).winner, 'impostors');

  const c4 = cfg('adivina', { rules: { guess: 'partial' } });
  g = R.createGame(c4, pool); const i4 = g.players.findIndex(p => p.role === 'impostor');
  R.eliminate(g, i4); R.applyGuess(g, i4, true);
  const w4 = R.checkWin(g); assert.strictEqual(w4.winner, 'crew'); assert.deepStrictEqual(g.partial, [i4]);

  const c5 = cfg('clasico', { rules: { winRule: 'superiority' } }, ['A', 'B', 'C']);
  g = R.createGame(c5, pool); R.eliminate(g, g.players.findIndex(p => p.role === 'crew'));
  assert.strictEqual(R.checkWin(g).winner, 'impostors', '1 contra 1 termina');
});

t('pistas: repetidas y demasiado evidentes', () => {
  const c = cfg('limitadas'); const g = R.createGame(c, R.buildPool(cat, c).pool);
  g.clues.push({ idx: 0, text: 'Algo grande' });
  assert(R.checkClue(g, 1, 'algo  GRANDE').repeat);
  assert(R.checkClue(g, 1, 'es un ' + g.secret.w).obvious);
  assert(!R.checkClue(g, 1, 'zzzz').obvious);
});

t('palabra parecida: nunca vacía aunque queden pocas palabras sin salir', () => {
  const store = { custom: [{ id: 'c-x', name: 'X', words: ['uno', 'dos', 'tres'].map((w, i) => ({ id: 'w' + i, w, sim: '' })) }] };
  const c2 = R.buildCatalog(WORDS, store);
  for (const mode of ['parecida', 'infiltrado']) {
    const c = { mode, players: ['A', 'B', 'C', 'D'], cats: ['c-x'], rules: R.rulesForMode(mode) };
    const info = R.buildPool(c2, c, ['c-x::uno', 'c-x::dos']);
    assert.deepStrictEqual(info.pool.map(p => p.w), ['tres'], mode + ': solo queda una sin salir');
    for (let k = 0; k < 20; k++) {
      const g = R.createGame(c, info.pool, undefined, info.alts);
      assert(g.secret.imp && g.secret.imp !== g.secret.w, mode + ': el impostor recibe otra palabra, no «' + g.secret.imp + '»');
      const i = g.players.findIndex(p => p.role === 'impostor');
      assert(R.cardFor(g, i).word, mode + ': tarjeta del impostor sin palabra');
    }
  }
});

t('ajustes recomendados son válidos', () => {
  for (const id of Object.keys(R.PRESETS)) {
    const players = Array.from({ length: 10 }, (_, i) => 'J' + i);
    const c = cfg('clasico', {}, players); R.PRESETS[id].apply(c.rules, 10);
    const v = R.validate(c, R.buildPool(cat, c));
    assert(v.ok, id + ': ' + v.errors.join(' '));
  }
});

t('ajustes recomendados: no estropean ningún modo', () => {
  for (const m of R.MODES) for (const id of Object.keys(R.PRESETS)) for (let n = 3; n <= 12; n++) {
    const players = Array.from({ length: n }, (_, i) => 'J' + i);
    const c = cfg(m.id, {}, players);
    if (!R.validate(c, R.buildPool(cat, c)).ok) continue;   // p. ej. «Varios impostores» con 3 jugadores
    c.rules = R.applyPreset(c.rules, m.id, id, n);
    const after = R.validate(c, R.buildPool(cat, c)).errors;
    assert.deepStrictEqual(after, [], `${m.id} + ${id} con ${n}: ${after.join(' ')}`);
    (m.locked || []).forEach(k => assert.deepStrictEqual(c.rules[k], R.rulesForMode(m.id)[k], `${m.id} + ${id}: cambia ${k}, que fija el modo`));
  }
});

t('simulación de partidas completas en todos los modos', () => {
  for (const m of R.MODES) for (let rep = 0; rep < 60; rep++) {
    const n = 3 + (rep % 8);
    const players = Array.from({ length: n }, (_, i) => 'J' + i);
    const c = cfg(m.id, {}, players);
    if (c.rules.impostors * 2 >= n) c.rules.impostors = Math.max(1, Math.ceil(n / 2) - 1);
    const pinfo = R.buildPool(cat, c);
    const v = R.validate(c, pinfo);
    if (m.minImpostors && n < 5) { assert(!v.ok); continue; }
    assert(v.ok, m.id + ' n=' + n + ': ' + v.errors.join(' '));
    const g = R.createGame(c, pinfo.pool);
    let res = null, guard = 0;
    while (!res && guard++ < 50) {
      const alive = g.players.map((p, i) => p.alive ? i : -1).filter(i => i >= 0);
      const votes = alive.map(() => alive[Math.floor(Math.random() * alive.length)]);
      const tl = R.tally(votes, 'random');
      if (tl.eliminated != null) {
        const wasImp = R.eliminate(g, tl.eliminated);
        if (wasImp && g.rules.guess !== 'off') R.applyGuess(g, tl.eliminated, Math.random() < 0.3);
      }
      res = R.checkWin(g);
      if (!res) g.round++;
    }
    assert(res, m.id + ' no terminó');
  }
});

console.log(`${passed} pruebas superadas`);

t('palabras con imagen', () => {
  const st = { custom: [{ id: 'cimg', name: 'Fotos', words: [
    { id: 'i1', w: 'Playa', img: 'a'.repeat(32), data: 'data:image/jpeg;base64,AAA' },
    { id: 'i2', w: 'Monte', img: '', data: 'data:image/jpeg;base64,BBB' },
    { id: 'i3', w: 'Imagen', img: 'c'.repeat(32), data: '' },
    { id: 'i4', w: 'Imagen', img: 'd'.repeat(32), data: '' } ] }] };
  const c2 = R.buildCatalog(WORDS, st);
  const cat = c2.find(c => c.id === 'cimg');
  assert.strictEqual(new Set(cat.words.map(w => w.key)).size, 4, 'imágenes con mismo nombre no chocan');
  const base = { mode: 'parecida', players: ['A', 'B', 'C', 'D'], cats: ['cimg'], rules: R.rulesForMode('parecida') };
  const local = R.buildPool(c2, base); assert.strictEqual(local.total, 4);
  const jam = R.buildPool(c2, Object.assign({ jam: true }, base));
  assert.strictEqual(jam.total, 3); assert.strictEqual(jam.skippedImg, 1);
  assert(R.validate(base, jam).warnings.some(w => w.includes('solo en este móvil')));
  for (let k = 0; k < 50; k++) {
    const g = R.createGame(base, local.pool);
    g.players.forEach((p, i) => {
      const cd = R.cardFor(g, i);
      assert(cd.img || cd.data, 'la tarjeta lleva imagen');
      if (p.role === 'impostor') assert.notStrictEqual(cd.img + cd.data, g.secret.img + g.secret.data, 'impostor con la misma imagen');
    });
  }
});
console.log('imágenes OK');

t('impostores aleatorios', () => {
  const players = Array.from({ length: 9 }, (_, i) => 'J' + i);
  const c = { mode: 'aleatorio', players, cats: allIds, rules: R.rulesForMode('aleatorio') };
  const pool = R.buildPool(cat, c).pool, seen = new Set();
  assert(R.validate(c, { total: pool.length }).ok);
  for (let i = 0; i < 400; i++) {
    const g = R.createGame(c, pool), k = g.players.filter(p => p.role === 'impostor').length;
    assert(k >= 1 && k <= 4 && k === g.rules.impostors, 'k=' + k); seen.add(k);
    g.players.forEach((p, j) => { if (p.role === 'impostor') assert.strictEqual(R.cardFor(g, j).mates.length, 0, 'no se conocen'); });
  }
  assert.strictEqual(seen.size, 4, 'salen de 1 a 4: ' + [...seen]);
  const c2 = JSON.parse(JSON.stringify(c)); c2.rules.knowEachOther = true; c2.rules.impMin = 2; c2.rules.impMax = 2;
  const g2 = R.createGame(c2, pool); g2.players.forEach((p, j) => { if (p.role === 'impostor') assert.strictEqual(R.cardFor(g2, j).mates.length, 1); });
  const c3 = JSON.parse(JSON.stringify(c)); c3.rules.impMin = 4; c3.players = players.slice(0, 6);
  assert(!R.validate(c3, { total: 10 }).ok, 'mínimo imposible');
  // estado tras echar a un impostor
  const c4 = JSON.parse(JSON.stringify(c)); c4.rules.impMin = 2; c4.rules.impMax = 2;
  const g4 = R.createGame(c4, pool); const imps = g4.players.map((p, i) => p.role === 'impostor' ? i : -1).filter(i => i >= 0);
  R.eliminate(g4, imps[0]); assert.strictEqual(R.statusAfterVote(g4).kind, 'go');
  assert(R.statusAfterVote(g4).text.includes('al menos un impostor'));
  g4.round++; R.eliminate(g4, imps[1]); assert.strictEqual(R.statusAfterVote(g4).kind, 'crew');
});
console.log('aleatorio OK');
