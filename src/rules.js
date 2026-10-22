/* =========================================================
   REGLAS DEL JUEGO (lógica pura, sin interfaz ni almacenamiento)
   Todo lo que decide quién es impostor, qué palabra sale, quién
   gana o si una configuración es válida vive aquí.
   ========================================================= */
const Rules = (() => {

  /* ---------- utilidades ---------- */
  const norm = s => String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const keyOf = (catId, w) => catId + '::' + norm(w);
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /* RNG criptográfico cuando existe (reparto justo); Math.random si no */
  const defaultRng = () => {
    try {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] / 4294967296;
      }
    } catch (e) {}
    return Math.random();
  };
  const splitWord = s => { const [w, sim] = String(s).split('|'); return { w: w.trim(), sim: sim ? sim.trim() : '' }; };

  /* ---------- tipos de pista ---------- */
  const CLUE_TYPES = {
    libre:      { label: 'Pista libre', hint: 'Di algo relacionado con la palabra sin decirla.' },
    una:        { label: 'Una sola palabra', hint: 'Solo una palabra. Ni una más.' },
    frase:      { label: 'Frase breve', hint: 'Como máximo cinco palabras.' },
    asociacion: { label: 'Asociación', hint: 'Lo primero que te venga a la cabeza al pensar en la palabra.' },
    gesto:      { label: 'Gesto', hint: 'Sin hablar: solo mímica o un gesto.' },
    pregunta:   { label: 'Responde a la pregunta', hint: 'Contesta pensando en tu palabra.' },
    aleatoria:  { label: 'Aleatoria', hint: 'Cada ronda cambia el tipo de pista.' }
  };

  /* ---------- reglas por defecto ---------- */
  function defaultRules() {
    return {
      impostors: 1,
      randomImpostors: false,    // el número se elige al azar al repartir
      impMin: 1, impMax: 0,      // rango (impMax 0 = el máximo posible)
      impostorInfo: 'none',      // none | category | similar | unaware
      hideCategory: false,       // nadie ve la categoría
      knowEachOther: true,       // los impostores se conocen entre sí
      turnStyle: 'pistas',       // pistas | preguntas
      clueType: 'libre',
      clueRounds: 1,             // rondas de pistas antes de cada votación
      timers: { clue: 0, debate: 0, vote: 0 }, // segundos, 0 = sin límite
      timeoutPenalty: 'none',    // none | random | impostors  (si se agota la votación)
      voting: 'group',           // group (el grupo decide) | secret (voto secreto pasando el móvil)
      tie: 'revote',             // revote | none | random   (solo voto secreto)
      revealOnElim: true,        // mostrar el rol del eliminado
      maxRounds: 0,              // 0 = hasta que alguien gane
      winRule: 'parity',         // parity: impostores >= normales · superiority: impostores > normales
      guess: 'off',              // off | win | partial
      registerClues: false,      // anotar las pistas en la app
      maxClues: 0,               // pistas máximas por jugador en toda la partida (0 = sin límite)
      cluePenalty: 'none',       // none | warn | lose
      difficulty: 'all',         // all | easy | hard
      avoidRepeats: true,
      useCustom: true,
      favOnly: false
    };
  }

  /* ---------- modos de juego ---------- */
  // rules: valores que impone el modo · locked: opciones que no se pueden cambiar en ese modo
  const MODES = [
    { id: 'clasico', n: 1, name: 'Clásico', tag: 'El de siempre',
      how: 'Todos reciben la misma palabra menos los impostores, que no reciben nada. Por turnos cada uno da una pista, se debate y se vota. Si jugáis con una sola categoría, el impostor la conoce de hecho.',
      rules: { impostorInfo: 'none' }, locked: ['impostorInfo'] },
    { id: 'parecida', n: 2, name: 'Palabra parecida', tag: 'Casi, pero no',
      how: 'Los normales reciben una palabra y el impostor otra muy parecida (playa / piscina). El impostor sabe que la suya es distinta, pero no cuál es la buena.',
      rules: { impostorInfo: 'similar' }, locked: ['impostorInfo'] },
    { id: 'categoria', n: 3, name: 'El impostor sabe la categoría', tag: 'Con una ayudita',
      how: 'El impostor no conoce la palabra, pero sí su categoría. Le toca improvisar pistas creíbles dentro de ese tema.',
      rules: { impostorInfo: 'category' }, locked: ['impostorInfo'] },
    { id: 'ciegas', n: 4, name: 'Impostor a ciegas', tag: 'Modo difícil',
      how: 'El impostor no sabe ni la palabra ni la categoría, y nadie ve la categoría en pantalla. Funciona mejor mezclando varias categorías.',
      rules: { impostorInfo: 'none', hideCategory: true }, locked: ['impostorInfo', 'hideCategory'] },
    { id: 'varios', n: 5, name: 'Varios impostores', tag: 'Equipo rival',
      how: 'Dos o más impostores. Puedes decidir si se conocen entre ellos. Recomendado a partir de 6 jugadores.',
      rules: { impostors: 2, impostorInfo: 'none' }, locked: ['impostorInfo'], minImpostors: 2 },
    { id: 'infiltrado', n: 6, name: 'El infiltrado', tag: 'Ni él lo sabe',
      how: 'Todos reciben una palabra, pero el infiltrado recibe una parecida y no sabe que es distinta. Su tarjeta parece igual que la de los demás.',
      rules: { impostorInfo: 'unaware' }, locked: ['impostorInfo'] },
    { id: 'contrarreloj', n: 7, name: 'Contra el tiempo', tag: 'Sin pensarlo mucho',
      how: 'Tiempo limitado para cada pista, para el debate y para votar. Si se acaba el tiempo de votación se aplica la consecuencia que elijáis.',
      rules: { timers: { clue: 15, debate: 60, vote: 20 }, timeoutPenalty: 'random' }, locked: [] },
    { id: 'obligatoria', n: 8, name: 'Pista obligatoria', tag: 'Con condiciones',
      how: 'Cada pista debe cumplir una condición: una palabra, una frase breve, una asociación, un gesto o responder a una pregunta. En «aleatoria» cambia cada ronda.',
      rules: { clueType: 'aleatoria' }, locked: [] },
    { id: 'preguntas', n: 9, name: 'Ronda de preguntas', tag: 'Interrogatorio',
      how: 'En vez de pistas libres, por turnos un jugador pregunta a otro. La app indica quién pregunta a quién y sugiere preguntas. El impostor debe responder sin conocer la palabra.',
      rules: { turnStyle: 'preguntas' }, locked: ['turnStyle'] },
    { id: 'adivina', n: 10, name: 'El impostor puede adivinar', tag: 'Última oportunidad',
      how: 'Si pilláis al impostor, tiene un intento para decir la palabra secreta. Si acierta, gana la partida (o una victoria parcial, si así lo configuras).',
      rules: { guess: 'win' }, locked: [] },
    { id: 'limitadas', n: 11, name: 'Pistas limitadas', tag: 'Cada palabra cuenta',
      how: 'Cada jugador tiene un número máximo de pistas en toda la partida. Se anotan en la app, que detecta repeticiones y pistas que contienen la palabra y las penaliza.',
      rules: { registerClues: true, maxClues: 2, cluePenalty: 'lose', clueRounds: 1 }, locked: ['registerClues'] },
    { id: 'aleatorio', n: 13, name: 'Impostores aleatorios', tag: '¿Cuántos hay?',
      how: 'Al repartir, la app elige al azar cuántos impostores hay dentro del rango que marques. Nadie sabe el número. Puedes decidir si los impostores se conocen entre ellos. Cada vez que echéis a alguien, la app dirá si quedan impostores o si ya habéis ganado.',
      rules: { randomImpostors: true, knowEachOther: false, impostorInfo: 'none' }, locked: ['randomImpostors'] },
    { id: 'personalizado', n: 12, name: 'Personalizado', tag: 'Tus reglas',
      how: 'Combina las reglas como quieras: número de impostores, qué saben, tiempos, tipo de pista, votación y última oportunidad.',
      rules: {}, locked: [] }
  ];
  const modeById = id => MODES.find(m => m.id === id) || MODES[0];
  const maxImpostors = n => Math.max(1, Math.ceil(n / 2) - 1);
  /* rango real de impostores para n jugadores */
  function impostorRange(r, n) {
    const top = maxImpostors(n);
    if (!r.randomImpostors) return [r.impostors, r.impostors];
    const hi = Math.min(r.impMax > 0 ? r.impMax : top, top);
    return [Math.min(Math.max(1, r.impMin), hi), hi];
  }

  function rulesForMode(modeId, base) {
    const m = modeById(modeId);
    const r = Object.assign(defaultRules(), base || {});
    const mr = JSON.parse(JSON.stringify(m.rules));
    Object.assign(r, mr);
    if (m.minImpostors && r.impostors < m.minImpostors) r.impostors = m.minImpostors;
    return r;
  }

  /* ---------- ajustes recomendados ---------- */
  const PRESETS = {
    rapida: { name: 'Partida rápida', desc: 'Una ronda de pistas y una sola votación.',
      apply: (r) => Object.assign(r, { clueRounds: 1, maxRounds: 1, voting: 'group', timers: { clue: 20, debate: 60, vote: 0 } }) },
    larga: { name: 'Partida larga', desc: 'Dos rondas de pistas, votaciones hasta el final y última oportunidad.',
      apply: (r) => Object.assign(r, { clueRounds: 2, maxRounds: 0, guess: r.guess === 'off' ? 'win' : r.guess, timers: { clue: 0, debate: 0, vote: 0 } }) },
    grupo: { name: 'Grupo numeroso', desc: 'Más impostores, debate con tiempo y voto en grupo.',
      apply: (r, n) => Object.assign(r, { impostors: Math.max(2, Math.floor((n || 8) / 4)), clueRounds: 1, maxRounds: 0, voting: 'group', timers: { clue: 15, debate: 120, vote: 0 } }) }
  };

  /* ---------- catálogo: palabras oficiales + personalizadas ---------- */
  // store: { custom:[{id,name,desc,h,words:[{id,w,sim}]}], added:{catId:[{id,w,sim}]}, wordState:{key:{off,fav}}, subOff:{'cat/sub':true} }
  function buildCatalog(official, store) {
    const st = store || {};
    const ws = st.wordState || {}, added = st.added || {}, subOff = st.subOff || {};
    const cats = [];
    const mkWord = (catId, w, sim, extra) => {
      const key = extra && (extra.img || extra.data) ? catId + '::img:' + extra.id : keyOf(catId, w);
      const s = ws[key] || {};
      return Object.assign({ key, w, sim: sim || '', off: !!s.off, fav: !!s.fav }, extra);
    };
    for (const c of official) {
      const words = [];
      const subs = [];
      if (c.subs) {
        for (const s of c.subs) {
          const subDisabled = !!subOff[c.id + '/' + s.id];
          subs.push({ id: s.id, name: s.name, off: subDisabled, count: s.words.length });
          for (const raw of s.words) { const p = splitWord(raw); words.push(mkWord(c.id, p.w, p.sim, { sub: s.id, subOff: subDisabled, user: false })); }
        }
      } else {
        for (const raw of c.words) { const p = splitWord(raw); words.push(mkWord(c.id, p.w, p.sim, { user: false })); }
      }
      for (const a of (added[c.id] || [])) words.push(mkWord(c.id, a.w, a.sim, { id: a.id, user: true, img: a.img || '', data: a.data || '' }));
      cats.push({ id: c.id, name: c.name, desc: c.desc, ab: c.ab, h: c.h, d: c.d, adult: !!c.adult, custom: false, subs, words });
    }
    for (const c of (st.custom || [])) {
      cats.push({ id: c.id, name: c.name, desc: c.desc || 'Lista personalizada', ab: abbr(c.name), h: c.h == null ? 160 : c.h, d: 2,
        custom: true, subs: [], words: (c.words || []).map(a => mkWord(c.id, a.w, a.sim, { id: a.id, user: true, img: a.img || '', data: a.data || '' })) });
    }
    return cats;
  }
  function abbr(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    const a = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
    return a.charAt(0).toUpperCase() + a.slice(1).toLowerCase();
  }

  /* palabras disponibles para una partida */
  function buildPool(catalog, cfg, usedKeys) {
    const r = cfg.rules;
    const sel = new Set(cfg.cats || []);
    let pool = [], skippedImg = 0;
    for (const c of catalog) {
      if (!sel.has(c.id)) continue;
      if (r.difficulty === 'easy' && c.d >= 3) continue;
      if (r.difficulty === 'hard' && c.d < 2) continue;
      for (const w of c.words) {
        if (w.off || w.subOff) continue;
        if (!r.useCustom && (w.user || c.custom)) continue;
        if (r.favOnly && !w.fav) continue;
        // en modo sala solo valen imágenes subidas (las locales no llegan a otros móviles)
        if (cfg.jam && w.data && !w.img) { skippedImg++; continue; }
        pool.push({ key: w.key, w: w.w, sim: w.sim, catId: c.id, catName: c.name, sub: w.sub, img: w.img || '', data: w.data || '' });
      }
    }
    // modos con palabra parecida: hace falta una alternativa
    if (r.impostorInfo === 'similar' || r.impostorInfo === 'unaware') {
      const perCat = {};
      pool.forEach(p => { perCat[p.catId] = (perCat[p.catId] || 0) + 1; });
      pool = pool.filter(p => p.sim || perCat[p.catId] >= 2);
    }
    const total = pool.length;
    // alts: de dónde sacar la palabra parecida, también entre las que ya han salido
    const alts = pool;
    let recycled = false;
    if (r.avoidRepeats && usedKeys && usedKeys.length) {
      const used = new Set(usedKeys);
      const fresh = pool.filter(p => !used.has(p.key));
      if (fresh.length) pool = fresh; else if (total) recycled = true;
    }
    return { pool, alts, total, recycled, skippedImg };
  }

  /* ---------- validación ---------- */
  function validate(cfg, poolInfo) {
    const errors = [], warnings = [];
    const r = cfg.rules;
    const names = (cfg.players || []).map(p => String(p || '').trim());
    const n = names.length, k = r.impostors;
    const m = modeById(cfg.mode);
    if (n < 3) errors.push('Hacen falta al menos 3 jugadores.');
    if (n > 30) errors.push('El máximo es de 30 jugadores.');
    const seen = new Set();
    for (const nm of names) {
      const x = norm(nm);
      if (!x) continue;
      if (seen.has(x)) { errors.push(`Hay dos jugadores llamados «${nm}». Cambia uno de los nombres.`); break; }
      seen.add(x);
    }
    if (r.randomImpostors) {
      if (r.impMax > 0 && r.impMin > r.impMax) errors.push('El mínimo de impostores no puede ser mayor que el máximo.');
      else if (n >= 3 && r.impMin > maxImpostors(n)) errors.push(`Con ${n} jugadores puede haber como mucho ${maxImpostors(n)} impostor${maxImpostors(n) === 1 ? '' : 'es'}: baja el mínimo.`);
      else if (n >= 3) { const [a, b] = impostorRange(r, n); if (a === b) warnings.push(`Con ${n} jugadores el rango solo permite ${a} impostor${a === 1 ? '' : 'es'}: no habrá sorpresa.`); }
      if (r.maxRounds > 0 && n >= 3 && r.maxRounds < impostorRange(r, n)[1]) warnings.push('Puede haber más impostores que votaciones: quizá no dé tiempo a descubrirlos a todos.');
    }
    if (!r.randomImpostors && k < 1) errors.push('Tiene que haber al menos un impostor.');
    if (!r.randomImpostors && m.minImpostors && k < m.minImpostors) errors.push(`El modo ${m.name} necesita al menos ${m.minImpostors} impostores.`);
    if (!r.randomImpostors && n >= 3 && k * 2 >= n) errors.push(`Con ${n} jugadores puede haber como mucho ${Math.max(1, Math.ceil(n / 2) - 1)} impostor${Math.ceil(n / 2) - 1 === 1 ? '' : 'es'}: debe haber más jugadores normales que impostores.`);
    if (!cfg.cats || !cfg.cats.length) errors.push('Elige al menos una categoría.');
    else if (poolInfo && poolInfo.total === 0) {
      errors.push((r.impostorInfo === 'similar' || r.impostorInfo === 'unaware')
        ? 'No hay palabras utilizables: este modo necesita palabras con pareja o categorías con al menos dos palabras activas.'
        : 'No hay palabras disponibles con esta selección. Revisa categorías, dificultad, favoritas o palabras desactivadas.');
    }
    if (!r.randomImpostors && r.maxRounds > 0 && r.maxRounds < k) errors.push(`Con ${k} impostores hacen falta al menos ${k} votaciones para poder descubrirlos a todos.`);
    if (r.clueRounds < 1) errors.push('Tiene que haber al menos una ronda de pistas.');
    // avisos
    if (poolInfo && poolInfo.total > 0 && poolInfo.total < 10) warnings.push(`Solo hay ${poolInfo.total} palabra${poolInfo.total === 1 ? '' : 's'} disponible${poolInfo.total === 1 ? '' : 's'}: se repetirán a menudo.`);
    if (poolInfo && poolInfo.skippedImg) warnings.push(`${poolInfo.skippedImg === 1 ? 'Una imagen guardada solo en este móvil no se usará' : poolInfo.skippedImg + ' imágenes guardadas solo en este móvil no se usarán'}: en la sala solo valen las imágenes subidas.`);
    if (poolInfo && poolInfo.recycled) warnings.push('Ya han salido todas las palabras de esta selección; vuelven a estar disponibles.');
    if (r.hideCategory && cfg.cats && cfg.cats.length === 1) warnings.push('Con una sola categoría el impostor puede deducirla fácilmente. Mejor mezclar varias.');
    if (!r.randomImpostors && k >= 2 && n < 6) warnings.push('Con menos de 6 jugadores, dos impostores lo tienen muy fácil.');
    if (r.cluePenalty !== 'none' && !r.registerClues) warnings.push('Las penalizaciones por pistas repetidas solo funcionan si se anotan las pistas.');
    if (r.voting === 'secret' && r.timers.vote) warnings.push('El tiempo de votación solo se aplica al voto en grupo.');
    if (r.maxClues > 0 && r.maxClues < r.clueRounds) warnings.push(`Cada jugador tiene ${r.maxClues} pista${r.maxClues === 1 ? '' : 's'} pero hay ${r.clueRounds} rondas: alguien se quedará sin hablar.`);
    if (r.impostorInfo === 'unaware' && r.guess !== 'off') warnings.push('El infiltrado no sabe que lo es, pero podrá adivinar la palabra si lo descubren.');
    return { errors, warnings, ok: errors.length === 0 };
  }

  /* ---------- crear partida ---------- */
  function assignRoles(n, k, rng) {
    const idx = shuffle([...Array(n).keys()], rng || defaultRng);
    const imp = new Set(idx.slice(0, k));
    return [...Array(n).keys()].map(i => imp.has(i) ? 'impostor' : 'crew');
  }

  /* palabra (o imagen) parecida para el impostor */
  function similarFor(secret, pool, rng) {
    if (!secret.img && !secret.data && secret.sim && norm(secret.sim) !== norm(secret.w)) return { w: secret.sim, img: '', data: '' };
    const others = pool.filter(p => p.catId === secret.catId && p.key !== secret.key && (secret.img || secret.data || norm(p.w) !== norm(secret.w)));
    const o = others.length ? pick(others, rng) : null;
    return o ? { w: o.w, img: o.img || '', data: o.data || '' } : { w: '', img: '', data: '' };
  }

  // alts (opcional): palabras de las que puede salir la parecida; por defecto, el propio pool
  function createGame(cfg, pool, rng, alts) {
    rng = rng || defaultRng;
    const r = JSON.parse(JSON.stringify(cfg.rules));
    const names = cfg.players.map((p, i) => String(p || '').trim() || `Jugador ${i + 1}`);
    if (r.randomImpostors) { const [a, b] = impostorRange(r, names.length); r.impostors = a + Math.floor(rng() * (b - a + 1)); }
    const roles = assignRoles(names.length, r.impostors, rng);
    const secret = Object.assign({}, pick(pool, rng));
    if (r.impostorInfo === 'similar' || r.impostorInfo === 'unaware') {
      const sm = similarFor(secret, alts || pool, rng); secret.imp = sm.w; secret.impImg = sm.img; secret.impData = sm.data;
    }
    const players = names.map((name, i) => ({ name, role: roles[i], alive: true, cluesLeft: r.maxClues || 0, penalties: 0, votedOut: 0 }));
    return {
      id: Date.now().toString(36) + Math.floor(rng() * 1e6).toString(36),
      mode: cfg.mode, rules: r, cats: cfg.cats.slice(), players, secret,
      start: Math.floor(rng() * names.length),
      round: 1, clueRound: 1, turn: 0, phase: 'reveal', revealIdx: 0,
      clues: [], events: [], partial: [], result: null, startedAt: Date.now()
    };
  }

  /* qué ve cada jugador en su tarjeta */
  function cardFor(game, i) {
    const p = game.players[i], r = game.rules, s = game.secret;
    const showCat = !r.hideCategory;
    const pic = (img, data) => ({ img: img || '', data: data || '' });
    if (p.role === 'crew') return Object.assign({ kind: 'crew', word: s.w, category: showCat ? s.catName : '' }, r.randomImpostors ? { note: 'Puede haber uno o varios impostores. Nadie sabe cuántos.' } : {}, pic(s.img, s.data));
    // impostor
    const mates = r.impostors > 1 && r.knowEachOther && r.impostorInfo !== 'unaware'
      ? game.players.filter((q, j) => j !== i && q.role === 'impostor').map(q => q.name) : [];
    const alone = r.randomImpostors && !r.knowEachOther ? ' Puede haber más impostores, pero no sabes quiénes ni cuántos.' : (r.randomImpostors && r.knowEachOther && r.impostors === 1 ? ' Esta vez eres el único impostor.' : '');
    if (r.impostorInfo === 'unaware') return Object.assign({ kind: 'crew', word: s.imp, category: showCat ? s.catName : '' }, pic(s.impImg, s.impData));
    if (r.impostorInfo === 'similar') return Object.assign({ kind: 'impostor', word: s.imp, category: showCat ? s.catName : '', note: ((s.img || s.data) ? 'Tu imagen se parece a la de los demás, pero no es la misma.' : 'Tu palabra es parecida a la de los demás, pero no es la misma.') + alone, mates }, pic(s.impImg, s.impData));
    if (r.impostorInfo === 'category') return { kind: 'impostor', word: '', category: s.catName, note: 'No conoces la palabra, pero sí su categoría.' + alone, mates };
    return { kind: 'impostor', word: '', category: '', note: (r.hideCategory ? 'No sabes ni la palabra ni la categoría.' : 'No conoces la palabra. Escucha y disimula.') + alone, mates };
  }

  /* orden de turnos de la ronda actual: jugadores vivos empezando por "start" */
  function turnOrder(game) {
    const n = game.players.length, out = [];
    const offset = (game.start + game.round - 1 + game.clueRound - 1) % n;
    for (let j = 0; j < n; j++) { const i = (offset + j) % n; if (game.players[i].alive) out.push(i); }
    return out;
  }

  /* en «preguntas»: quién pregunta a quién */
  function questionTarget(game, order, t, rng) {
    if (order.length < 2) return null;
    // pregunta al siguiente en el orden (simple y justo: todos preguntan y responden una vez)
    return order[(t + 1) % order.length];
  }

  function clueCondition(rules, roundSeed, rng) {
    rng = rng || defaultRng;
    let type = rules.clueType;
    if (type === 'aleatoria') type = pick(['una', 'frase', 'asociacion', 'gesto', 'pregunta'], rng);
    return { type, label: CLUE_TYPES[type].label, hint: CLUE_TYPES[type].hint };
  }

  /* comprobar una pista anotada */
  function checkClue(game, playerIdx, text) {
    const t = norm(text);
    if (!t) return { empty: true, repeat: false, obvious: false };
    const words = [game.secret.w, game.secret.imp].filter(Boolean).map(norm);
    const padded = ' ' + t + ' ';
    const obvious = words.some(w => w && (padded.includes(' ' + w + ' ') || t === w));
    const repeat = game.clues.some(c => c.text && norm(c.text) === t);
    return { empty: false, repeat, obvious };
  }

  /* ---------- votación ---------- */
  // votes: array de índices votados (-1 = en blanco). alive: índices vivos
  function tally(votes, tieRule, rng) {
    rng = rng || defaultRng;
    const counts = {};
    votes.forEach(v => { if (v >= 0) counts[v] = (counts[v] || 0) + 1; });
    const entries = Object.entries(counts).map(([i, c]) => [Number(i), c]);
    if (!entries.length) return { counts, top: [], eliminated: null, tie: false };
    const max = Math.max(...entries.map(e => e[1]));
    const top = entries.filter(e => e[1] === max).map(e => e[0]);
    if (top.length === 1) return { counts, top, eliminated: top[0], tie: false };
    if (tieRule === 'random') return { counts, top, eliminated: pick(top, rng), tie: true };
    if (tieRule === 'revote') return { counts, top, eliminated: null, tie: true, revote: true };
    return { counts, top, eliminated: null, tie: true };
  }

  function aliveCounts(game) {
    let imp = 0, crew = 0;
    game.players.forEach(p => { if (p.alive) { if (p.role === 'impostor') imp++; else crew++; } });
    return { imp, crew };
  }

  function eliminate(game, i) {
    const p = game.players[i];
    p.alive = false;
    game.events.push({ t: 'elim', round: game.round, idx: i, role: p.role });
    return p.role === 'impostor';
  }

  /* ¿ha terminado la partida? Se llama tras resolver cada votación. */
  function checkWin(game) {
    const r = game.rules;
    const { imp, crew } = aliveCounts(game);
    if (game.forcedWinner) return { winner: game.forcedWinner, reason: game.forcedReason || 'guess' };
    if (imp === 0) return { winner: 'crew', reason: 'caught' };
    if (r.winRule === 'parity' ? imp >= crew : imp > crew) return { winner: 'impostors', reason: 'numbers' };
    if (imp + crew <= 2) return { winner: 'impostors', reason: 'numbers' };
    if (r.maxRounds > 0 && game.round >= r.maxRounds) return { winner: 'impostors', reason: 'survived' };
    return null;
  }

  /* intento de adivinar la palabra del impostor descubierto */
  function guessMatches(game, text) {
    const g = norm(text), w = norm(game.secret.w);
    if (!g) return false;
    if (g === w) return true;
    // admite plurales y artículos sencillos
    const strip = s => s.replace(/^(el|la|los|las|un|una) /, '').replace(/(es|s)$/, '');
    return strip(g) === strip(w);
  }

  function applyGuess(game, idx, correct) {
    game.events.push({ t: 'guess', idx, correct });
    if (!correct) return;
    if (game.rules.guess === 'win') { game.forcedWinner = 'impostors'; game.forcedReason = 'guess'; }
    else if (game.rules.guess === 'partial') game.partial.push(idx);
  }

  /* qué decir tras una votación: seguir jugando o fin (sin revelar cuántos quedan) */
  function statusAfterVote(game) {
    const w = checkWin(game);
    if (w && w.winner === 'crew') return { kind: 'crew', text: 'No quedan impostores. ¡Ganan los jugadores!' };
    if (w) return { kind: 'imp', text: w.reason === 'survived' ? 'Se acabaron las votaciones con algún impostor dentro.' : w.reason === 'guess' ? 'El impostor ha adivinado la palabra.' : 'Los impostores ya son tantos como los demás. Ganan ellos.' };
    const last = game.events.filter(e => e.t === 'elim').pop();
    const caughtNow = last && last.round === game.round && last.role === 'impostor';
    return { kind: 'go', text: caughtNow ? 'Aún queda al menos un impostor. Seguid jugando.' : 'Al menos un impostor sigue entre vosotros. Seguid jugando.' };
  }
  return {
    norm, keyOf, maxImpostors, impostorRange, statusAfterVote, shuffle, defaultRng, splitWord, abbr,
    CLUE_TYPES, MODES, PRESETS, modeById, defaultRules, rulesForMode,
    buildCatalog, buildPool, validate,
    assignRoles, createGame, cardFor, turnOrder, questionTarget, clueCondition, checkClue,
    tally, aliveCounts, eliminate, checkWin, guessMatches, applyGuess
  };
})();

if (typeof module !== 'undefined') module.exports = Rules;
