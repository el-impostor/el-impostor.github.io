/* =========================================================
   INTERFAZ Y ALMACENAMIENTO
   Depende de WORDS / QUESTIONS (words.js) y Rules (rules.js).
   ========================================================= */
(() => {
  const R = Rules;
  const $app = document.getElementById('app');
  const LS_KEY = 'impostor.v1';
  const DEFAULT_CATS = ['cine', 'animales', 'comida', 'objetos', 'paises', 'profesiones', 'deportes', 'musica'];
  const TIMER_OPTS = [0, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300];

  /* ---------- utilidades ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const plural = (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`;
  const fmtTime = s => s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
  const fmtDate = ts => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ' · ' + new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const vibrate = p => { try { if (Store.settings.vibrate && navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
  const rng = R.defaultRng;
  const pickQ = () => QUESTIONS[Math.floor(rng() * QUESTIONS.length)];
  const afterRender = [];
  /* ---------- sonidos (sintetizados con Web Audio: no hay archivos que cargar) ---------- */
  const Sound = (() => {
    let ctx = null;
    const on = () => Store.settings.sound !== false;
    function ac() {
      if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    function tone(f, dur, o = {}) {
      const c = ac(); if (!c) return;
      const t = c.currentTime + (o.at || 0), osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol || 0.1, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(c.destination); osc.start(t); osc.stop(t + dur + 0.03);
    }
    const S = {
      tap: () => tone(560, 0.055, { type: 'triangle', vol: 0.07, to: 400 }),
      toggle: () => tone(760, 0.05, { type: 'triangle', vol: 0.06 }),
      reveal: () => { tone(260, 0.28, { vol: 0.1, to: 880 }); tone(1180, 0.16, { type: 'triangle', vol: 0.05, at: 0.14 }); },
      close: () => tone(700, 0.12, { vol: 0.07, to: 300 }),
      turn: () => { tone(660, 0.12, { vol: 0.11 }); tone(990, 0.18, { vol: 0.09, at: 0.1 }); },
      vote: () => { tone(200, 0.16, { type: 'square', vol: 0.05, to: 110 }); tone(90, 0.12, { vol: 0.12, at: 0.02 }); },
      out: () => { tone(420, 0.35, { type: 'sawtooth', vol: 0.05, to: 110 }); tone(70, 0.3, { vol: 0.14, at: 0.05 }); },
      tick: () => tone(1250, 0.045, { type: 'square', vol: 0.045 }),
      alarm: () => [0, 0.16, 0.32].forEach(a => tone(980, 0.11, { type: 'square', vol: 0.06, at: a })),
      win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.24, { type: 'triangle', vol: 0.09, at: i * 0.11 })),
      lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.09, at: i * 0.15 })),
      join: () => { tone(880, 0.08, { vol: 0.07 }); tone(1320, 0.1, { vol: 0.06, at: 0.07 }); },
      error: () => tone(150, 0.16, { type: 'square', vol: 0.05 })
    };
    return { play(n) { if (!on() || !S[n]) return; try { S[n](); } catch (e) {} } };
  })();
  const SOUND_FOR = { 'rv-flip': 'reveal', 'my-flip': 'reveal', 'rv-done': 'close', 'jp-ready': 'close', 'v-confirm': 'vote', 'sv-cast': 'vote', 'jp-vote': 'vote', 'jh-myvote': 'vote',
    'rule-tg': 'toggle', 'set-tg': 'toggle', 'sub-off': 'toggle', 'w-off': 'toggle', 'w-fav': 'toggle', 'cat-toggle': 'toggle', 'jh-plays': 'toggle', arm: 'error', quit: 'out', 'jh-close': 'out', 'jp-leave': 'out' };
  /* imagen de una palabra: copia local (data:) o archivo subido (assets) */
  const picSrc = (img, data) => data || (img ? '/_blob/' + img : '');
  const picTag = (src, alt, cls) => src ? `<img class="${cls || 'cb-img'}" src="${esc(src)}" alt="${esc(alt || 'Imagen secreta')}" draggable="false" onerror="this.classList.add('broken')">` : '';
  function cardBack(card) {
    const src = picSrc(card.img, card.data);
    const wordBlock = (cls) => src ? picTag(src, card.word) + (card.word ? `<div class="cb-cap">${esc(card.word)}</div>` : '') : `<div class="cb-word${cls}">${esc(card.word)}</div>`;
    if (card.kind === 'crew') return `<div class="cb-k">${src ? 'Tu imagen' : 'Tu palabra'}</div>${wordBlock('')}${card.category ? `<div class="cb-cat">${esc(card.category)}</div>` : ''}<p class="cb-note">Da pistas sin decirla y encuentra al impostor.</p>`;
    return `<div class="stamp">Impostor</div>
      ${card.word || src ? `<div class="cb-k">${src ? 'Tu imagen' : 'Tu palabra'}</div>${wordBlock(' sm')}` : ''}
      ${card.category ? `<div class="cb-k">Categoría</div><div class="cb-cat big">${esc(card.category)}</div>` : ''}
      <p class="cb-note">${esc(card.note || '')}</p>
      ${card.mates && card.mates.length ? `<div class="cb-k">${card.mates.length === 1 ? 'Tu compañero' : 'Tus compañeros'}</div><div class="cb-mates">${card.mates.map(esc).join(', ')}</div>` : ''}`;
  }
  function secretBlock(word, src, cat, imp, impSrc) {
    return `<div class="secret"><div class="cb-k">${src ? 'La imagen era' : 'La palabra era'}</div>${src ? picTag(src, word, 'secret-img') : ''}<div class="secret-w${src ? ' sm' : ''}">${esc(word)}</div>
      <div class="muted">${esc(cat)}${imp || impSrc ? ` · el impostor tenía «${esc(imp || 'otra imagen')}»` : ''}</div>${impSrc ? picTag(impSrc, imp, 'secret-img sm') : ''}</div>`;
  }

  /* ---------- almacenamiento ---------- */
  function defaultStore() {
    return {
      v: 1,
      settings: { theme: 'dark', stats: true, vibrate: true, sound: true, revealStyle: 'tap' },
      players: ['Ana', 'Bea', 'Carlos', 'Dani', 'Eva'],
      setup: null,
      custom: [{ id: 'c-ejemplo', name: 'Plan de viernes', desc: 'Lista de ejemplo: edítala o bórrala.', h: 160,
        words: ['karaoke|bolera', 'cena en casa|barbacoa', 'cine|teatro', 'escape room|gymkana', 'tapas|vermut', 'concierto|festival', 'juegos de mesa|cartas', 'noche de pelis|maratón de series']
          .map(s => Object.assign({ id: uid() }, R.splitWord(s))) }],
      added: {}, wordState: {}, subOff: {},
      used: [], history: [], playerStats: {}, game: null
    };
  }
  let storageOk = true;
  function loadStore() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === 1) { const d = defaultStore(); s.settings = Object.assign(d.settings, s.settings); return Object.assign(d, s); }
      }
    } catch (e) { storageOk = false; }
    return defaultStore();
  }
  const Store = loadStore();
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(Store)); } catch (e) { storageOk = false; }
  }

  /* ---------- estado de la interfaz ---------- */
  const UI = { view: 'home', args: {}, stack: [], open: {}, confirm: null, wordFilter: 'all', wordSearch: '', importOpen: false, editWord: null, modeInfo: null };
  const catalog = () => R.buildCatalog(WORDS, Store);

  function newSetup(mode) {
    return { mode: mode || 'clasico', players: Store.players.slice(), cats: DEFAULT_CATS.slice(), rules: R.rulesForMode(mode || 'clasico') };
  }
  function setup() {
    if (!Store.setup) Store.setup = newSetup();
    return Store.setup;
  }
  const MODE_KEYS = ['randomImpostors', 'knowEachOther', 'impostorInfo', 'hideCategory', 'turnStyle', 'clueType', 'timers', 'timeoutPenalty', 'guess', 'registerClues', 'maxClues', 'cluePenalty'];
  function changeMode(id) {
    const s = setup();
    const base = JSON.parse(JSON.stringify(s.rules));
    if (id !== 'personalizado') { const d = R.defaultRules(); MODE_KEYS.forEach(k => { base[k] = JSON.parse(JSON.stringify(d[k])); }); }
    if (s.mode === 'varios' && id !== 'varios' && id !== 'personalizado') base.impostors = 1;
    s.mode = id; s.rules = R.rulesForMode(id, base);
    fitImpostors();
  }
  function fitImpostors() {
    const s = setup(), n = s.players.length, maxK = Math.max(1, Math.ceil(n / 2) - 1);
    if (s.rules.impostors > maxK) s.rules.impostors = maxK;
    if (s.rules.impostors < 1) s.rules.impostors = 1;
  }
  const locked = k => (R.modeById(setup().mode).locked || []).includes(k);
  function setRule(path, val) {
    const r = setup().rules, parts = path.split('.');
    if (locked(parts[0])) return;
    let o = r; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
  }
  const getRule = path => path.split('.').reduce((o, k) => o[k], setup().rules);
  function poolInfo(cfg) { return R.buildPool(catalog(), cfg || (inJam() ? Object.assign({ jam: !Caps.jamData }, setup()) : setup()), Store.used); }
  function validation() {
    let s = setup();
    if (inJam()) s = Object.assign({}, s, { jam: !Caps.jamData, players: [...Array(Math.max(3, jamCount())).keys()].map(i => 'J' + i) });
    const v = R.validate(s, poolInfo(s));
    if (!s.rules.revealOnElim && s.rules.guess !== 'off') v.warnings.push('Con la última oportunidad activada, el expulsado que intente adivinar quedará delatado como impostor.');
    return v;
  }

  /* ---------- navegación ---------- */
  function go(view, args, replace) {
    if (!replace && UI.view !== view) UI.stack.push({ view: UI.view, args: UI.args });
    if (replace && UI.stack.length && UI.stack[UI.stack.length - 1].view === view) UI.stack.pop();
    UI.view = view; UI.args = args || {}; UI.confirm = null;
    render(true);
  }
  function back() {
    const prev = UI.stack.pop();
    if (prev) { UI.view = prev.view; UI.args = prev.args; } else UI.view = 'home';
    UI.confirm = null; render(true);
  }

  /* ---------- piezas de interfaz ---------- */
  const icon = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>'
  };
  function header(title, opts = {}) {
    const left = opts.noBack ? '<span class="hd-sp"></span>' : `<button class="icon-btn" data-a="${opts.backAct || 'back'}" aria-label="Volver">${icon.back}</button>`;
    return `<header class="hd"><div class="hd-in">${left}<h1 class="hd-title">${esc(title)}</h1>${opts.right || '<span class="hd-sp"></span>'}</div></header>`;
  }
  function seg(path, options, opts = {}) {
    const cur = getRule(path), dis = opts.disabled || locked(path.split('.')[0]);
    return `<div class="seg${dis ? ' is-locked' : ''}" role="radiogroup">${options.map(([v, l]) =>
      `<button role="radio" aria-checked="${cur === v}" class="seg-b${cur === v ? ' on' : ''}" data-a="rule" data-k="${path}" data-v='${JSON.stringify(v)}' ${dis ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
  }
  function sw(on, act, attrs = '', dis = false) {
    return `<button class="sw${on ? ' on' : ''}" role="switch" aria-checked="${!!on}" data-a="${act}" ${attrs} ${dis ? 'disabled' : ''}><span></span></button>`;
  }
  function row(label, desc, control, extra = '') {
    return `<div class="row ${extra}"><div class="row-tx"><div class="row-l">${label}</div>${desc ? `<div class="row-d">${desc}</div>` : ''}</div><div class="row-c">${control}</div></div>`;
  }
  function stepper(path, min, max, fmt) {
    const v = getRule(path), dis = locked(path.split('.')[0]);
    return `<div class="stp"><button class="stp-b" data-a="step" data-k="${path}" data-d="-1" data-min="${min}" data-max="${max}" aria-label="Menos" ${dis || v <= min ? 'disabled' : ''}>${icon.minus}</button><output class="stp-v">${fmt ? fmt(v) : v}</output><button class="stp-b" data-a="step" data-k="${path}" data-d="1" data-min="${min}" data-max="${max}" aria-label="Más" ${dis || v >= max ? 'disabled' : ''}>${icon.plus}</button></div>`;
  }
  function timerSelect(path) {
    const v = getRule(path);
    return `<select class="sel" data-in="rule-num" data-k="${path}" id="sel-${path.replace('.', '-')}">${TIMER_OPTS.map(o => `<option value="${o}" ${o === v ? 'selected' : ''}>${o ? fmtTime(o) : 'Sin límite'}</option>`).join('')}</select>`;
  }
  const lockNote = k => locked(k) ? `<span class="lock">fijado por el modo</span>` : '';
  const catColor = h => `hsl(${h} 62% var(--tile-l))`;
  function tile(c, opts = {}) {
    const active = c.words.filter(w => !w.off && !w.subOff).length;
    return `<div class="tile${opts.on ? ' on' : ''}" style="--c:${catColor(c.h)}">
      <button class="tile-main" data-a="${opts.act || 'cat-toggle'}" data-id="${c.id}" aria-pressed="${!!opts.on}">
        <span class="tile-n">${active}</span><span class="tile-ab">${esc(c.ab)}</span>
        <span class="tile-name">${esc(c.name)}</span>
        <span class="tile-d">${c.custom ? 'Personal' : ['', 'Fácil', 'Normal', 'Difícil'][c.d]}</span>
      </button>
      ${opts.more ? `<button class="tile-more" data-a="cat-edit" data-id="${c.id}" aria-label="Ver palabras de ${esc(c.name)}">${icon.more}</button>` : ''}
    </div>`;
  }
  function confirmBtn(id, label, confirmLabel, act, cls = '', attrs = '') {
    const armed = UI.confirm === id;
    return `<button class="btn ${cls}${armed ? ' armed' : ''}" data-a="${armed ? act : 'arm'}" data-id="${id}" ${attrs}>${armed ? confirmLabel : label}</button>`;
  }
  function toast(msg, kind) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = 'toast show ' + (kind || '');
    if (kind === 'warn') Sound.play('error');
    t.textContent = msg;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  /* =========================================================
     PANTALLAS
     ========================================================= */
  const V = {};

  /* ---------- 1. Inicio ---------- */
  V.home = () => {
    const g = Store.game, live = g && g.phase !== 'end';
    const s = setup(), m = R.modeById(s.mode);
    return `<main class="home">
      <div class="home-top">
        <div class="brand">
          <div class="brand-kicker">Juego de deducción · 3 a 30 jugadores</div>
          <h1 class="brand-title">El<br>Impostor</h1>
          <p class="brand-sub">Todos conocen la palabra secreta. Todos menos uno.</p>
        </div>
        <div class="stamp-deco" aria-hidden="true">?</div>
      </div>
      ${live ? resumeRow('resume', 'Continuar partida', 'home-quit', 'Abandonar partida', '¿Seguro? Toca otra vez', 'home-quit-do') : ''}
      ${Store.jam ? resumeRow('jh-resume', `Volver a tu sala ${esc(Store.jam.code.toUpperCase())}`, 'home-jh-close', 'Cerrar sala', '¿Cerrarla? Toca otra vez', 'jh-close') : ''}
      ${Store.join && !Store.jam ? resumeRow('jp-resume', `Volver a la sala ${esc(Store.join.code.toUpperCase())}`, 'home-jp-leave', 'Salir de la sala', '¿Salir? Toca otra vez', 'jp-leave') : ''}
      <button class="btn ${live || Store.jam ? '' : 'btn-accent'} big" data-a="quick">
        <span class="btn-stack"><span>Jugar con un solo móvil</span><small>${esc(m.name)} · ${plural(s.players.length, 'jugador', 'jugadores')} · ${impLabel(s)}</small></span>
      </button>
      <div class="jam-cta">
        <div class="jam-cta-tx"><span class="hcard-k">Cada uno en su móvil</span><span class="hcard-t">Jugar en sala</span><span class="muted small">Se entra con QR o enlace. Sin pasarse el móvil.</span></div>
        <div class="jam-cta-b">${Caps.canEdit ? `<button class="btn btn-accent" data-a="jh-create">Crear sala</button>` : ''}<button class="btn" data-a="jam-join">Unirme</button></div>
        ${Caps.ready && !Caps.room ? `<p class="muted small">${Caps.standalone ? 'Sin conexión a internet no se puede crear ni unirse a salas.' : 'La sala solo funciona abriendo la app desde su enlace de Claude con la sesión iniciada.'}</p>` : ''}
      </div>
      <div class="home-grid">
        <button class="hcard" data-a="nav" data-to="modes"><span class="hcard-k">13 modos</span><span class="hcard-t">Elegir modo</span></button>
        <button class="hcard" data-a="nav" data-to="setup"><span class="hcard-k">Jugadores y reglas</span><span class="hcard-t">Configurar</span></button>
        <button class="hcard" data-a="nav" data-to="words"><span class="hcard-k">Listas propias</span><span class="hcard-t">Palabras</span></button>
        <button class="hcard" data-a="nav" data-to="stats"><span class="hcard-k">Historial</span><span class="hcard-t">Estadísticas</span></button>
      </div>
      <div class="home-foot">
        <button class="link" data-a="nav" data-to="help">Cómo se juega</button>
        <button class="link" data-a="nav" data-to="settings">Ajustes</button>
      </div>
      ${storageOk ? '' : '<p class="note warn">Este navegador no permite guardar datos: las palabras y estadísticas se perderán al cerrar.</p>'}
    </main>`;
  };

  function resumeRow(act, label, armId, quitLabel, confirmLabel, quitAct) {
    const armed = UI.confirm === armId;
    return `<div class="resume-row"><button class="btn btn-accent big" data-a="${act}">${label}</button>
      <button class="btn big quit-btn${armed ? ' armed' : ''}" data-a="${armed ? quitAct : 'arm'}" data-id="${armId}">${armed ? confirmLabel : quitLabel}</button></div>`;
  }
  /* «1 impostor», «2 impostores» o «1–3 impostores al azar» */
  function impLabel(s, n) {
    const r = s.rules; n = n || s.players.length;
    if (!r.randomImpostors) return plural(r.impostors, 'impostor', 'impostores');
    const [a, b] = R.impostorRange(r, Math.max(3, n));
    return a === b ? `${plural(a, 'impostor', 'impostores')} (al azar)` : `${a}–${b} impostores al azar`;
  }
  /* aviso tras una votación: seguir jugando o fin */
  function statusLine(g) {
    if (!g.lastVote || g.guessState === 'pending') return '';
    const st = R.statusAfterVote(g);
    return `<div class="status ${st.kind}">${esc(st.text)}</div>`;
  }
  /* ---------- 2. Modos ---------- */
  V.modes = () => {
    const cur = setup().mode;
    return header('Modo de juego') + `<main class="pad"><div class="modes">${R.MODES.map(m => `
      <button class="mode${m.id === cur ? ' on' : ''}" data-a="mode-pick" data-id="${m.id}" aria-pressed="${m.id === cur}">
        <span class="mode-n">${String(m.n).padStart(2, '0')}</span>
        <span class="mode-tx"><span class="mode-name">${esc(m.name)}</span><span class="mode-tag">${esc(m.tag)}</span>
        ${m.id === cur ? `<span class="mode-how">${esc(m.how)}</span>` : ''}</span>
      </button>`).join('')}</div></main>
      <footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="nav" data-to="setup" data-replace="1">Continuar con ${esc(R.modeById(cur).name)}</button></div></footer>`;
  };

  /* ---------- 3. Configuración (jugadores + reglas) ---------- */
  const inJam = () => !!Store.jam && !Store.jam.game && UI.stack.some(x => x.view === 'jamHost');
  V.setup = () => {
    const s = setup(), r = s.rules, m = R.modeById(s.mode);
    const n = inJam() ? Math.max(3, jamCount()) : s.players.length;
    const cat = catalog(), sel = cat.filter(c => s.cats.includes(c.id));
    const maxK = Math.max(1, Math.ceil(n / 2) - 1);
    if (inJam() && r.impostors > maxK) r.impostors = maxK;
    const det = (id, title, body) => `<details class="grp" data-det="${id}" ${UI.open[id] ? 'open' : ''}><summary>${title}</summary><div class="grp-b">${body}</div></details>`;
    return header('Preparar partida') + `<main class="pad setup">
      <section class="sec">
        <button class="modecard" data-a="nav" data-to="modes">
          <span class="mode-n">${String(m.n).padStart(2, '0')}</span>
          <span class="mode-tx"><span class="mode-name">${esc(m.name)}</span><span class="mode-tag">${esc(m.tag)} · Cambiar</span></span>
        </button>
      </section>

      ${inJam() ? `<section class="sec"><div class="sec-h"><h2>Jugadores <span class="count">${jamCount()}</span></h2></div><p class="muted small">En la sala juegan quienes estén conectados al repartir. En sala se vota siempre en secreto desde cada móvil.</p></section>` : playersBlock()}

      <section class="sec">
        ${row('Número de impostores al azar', 'Se decide al repartir y nadie sabe cuántos hay. ' + lockNote('randomImpostors'), sw(r.randomImpostors, 'rule-tg', 'data-k="randomImpostors"', locked('randomImpostors')))}
        ${r.randomImpostors
          ? row('Mínimo de impostores', '', stepper('impMin', 1, maxK)) + row('Máximo de impostores', `Con ${n} jugadores, como mucho ${maxK}.`, stepper('impMax', 0, maxK, v => v ? v : 'Máx.'))
          : row('Impostores', `Con ${n} jugadores, máximo ${maxK}.`, stepper('impostors', m.minImpostors || 1, maxK))}
        ${r.randomImpostors || r.impostors > 1 ? row('Los impostores se conocen', r.randomImpostors ? 'Si no se conocen, ninguno sabe si está solo o tiene compañeros.' : 'Cada impostor ve quiénes son sus compañeros.', sw(r.knowEachOther, 'rule-tg', 'data-k="knowEachOther"', r.impostorInfo === 'unaware')) : ''}
      </section>

      <section class="sec">
        <div class="sec-h"><h2>Categorías <span class="count">${sel.length}</span></h2><button class="link" data-a="nav" data-to="cats">Elegir</button></div>
        <div class="chips">${sel.length ? sel.map(c => `<span class="chip" style="--c:${catColor(c.h)}">${esc(c.name)}</span>`).join('') : '<span class="muted">Ninguna seleccionada</span>'}</div>
      </section>

      <section class="sec">
        <div class="sec-h"><h2>Ajustes recomendados</h2></div>
        <div class="presets">${Object.entries(R.PRESETS).map(([id, p]) => `<button class="preset" data-a="preset" data-id="${id}"><b>${p.name}</b><span>${p.desc}</span></button>`).join('')}</div>
      </section>

      <section class="sec">
        <div class="sec-h"><h2>Reglas</h2></div>
        <div class="rule-b"><div class="row-l">Qué sabe el impostor ${lockNote('impostorInfo')}</div>
          ${seg('impostorInfo', [['none', 'Nada'], ['category', 'La categoría'], ['similar', 'Palabra parecida'], ['unaware', 'No sabe que lo es']])}</div>
        ${row('Ocultar la categoría', 'Nadie ve en qué categoría está la palabra. ' + lockNote('hideCategory'), sw(r.hideCategory, 'rule-tg', 'data-k="hideCategory"', locked('hideCategory')))}
        ${row('Rondas de pistas', 'Antes de cada votación.', stepper('clueRounds', 1, 5))}
        ${row('Votaciones máximas', 'Si se agotan y queda algún impostor, ganan ellos.', stepper('maxRounds', 0, 10, v => v ? v : '∞'))}
        <div class="rule-b"><div class="row-l">Votación</div>${seg('voting', [['group', 'El grupo decide'], ['secret', 'Voto secreto']])}</div>
        ${r.voting === 'secret' ? `<div class="rule-b"><div class="row-l">Si hay empate</div>${seg('tie', [['revote', 'Desempate'], ['none', 'Nadie sale'], ['random', 'Al azar']])}</div>` : ''}
        <div class="rule-b"><div class="row-l">Última oportunidad del impostor</div>${seg('guess', [['off', 'No'], ['win', 'Si acierta, gana'], ['partial', 'Victoria parcial']])}</div>
        ${det('mas', 'Turnos, pistas y victoria', `
          <div class="rule-b"><div class="row-l">Turnos ${lockNote('turnStyle')}</div>${seg('turnStyle', [['pistas', 'Pistas'], ['preguntas', 'Preguntas entre jugadores']])}</div>
          ${r.turnStyle === 'pistas' ? `<div class="rule-b"><div class="row-l">Tipo de pista</div>
            <select class="sel" id="sel-clueType" data-in="rule-str" data-k="clueType">${Object.entries(R.CLUE_TYPES).map(([k, c]) => `<option value="${k}" ${r.clueType === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
            <div class="row-d">${esc(R.CLUE_TYPES[r.clueType].hint)}</div></div>` : ''}
          ${row('Anotar las pistas', 'Se escriben en la app para revisarlas en el debate. ' + lockNote('registerClues'), sw(r.registerClues, 'rule-tg', 'data-k="registerClues"', locked('registerClues')))}
          ${row('Pistas por jugador', 'En toda la partida.', stepper('maxClues', 0, 10, v => v ? v : '∞'))}
          ${r.registerClues ? `<div class="rule-b"><div class="row-l">Pistas repetidas o que dicen la palabra</div>${seg('cluePenalty', [['none', 'Se permiten'], ['warn', 'Aviso'], ['lose', 'Pierde una pista']])}</div>` : ''}
          ${row('Mostrar el rol del expulsado', '', sw(r.revealOnElim, 'rule-tg', 'data-k="revealOnElim"'))}
          <div class="rule-b"><div class="row-l">Los impostores ganan si…</div>${seg('winRule', [['parity', 'Igualan en número'], ['superiority', 'Superan en número']])}</div>`)}
        ${det('tiempo', 'Tiempos', `
          ${row('Tiempo por pista', '', timerSelect('timers.clue'))}
          ${row('Tiempo de debate', '', timerSelect('timers.debate'))}
          ${row('Tiempo de votación', 'Solo con voto en grupo.', timerSelect('timers.vote'))}
          ${r.timers.vote && r.voting === 'group' ? `<div class="rule-b"><div class="row-l">Si se acaba el tiempo de votar</div>${seg('timeoutPenalty', [['none', 'Nadie sale'], ['random', 'Sale alguien al azar'], ['impostors', 'Ganan los impostores']])}</div>` : ''}`)}
        ${det('palabras', 'Palabras', `
          <div class="rule-b"><div class="row-l">Dificultad</div>${seg('difficulty', [['easy', 'Fácil'], ['all', 'Todas'], ['hard', 'Difícil']])}</div>
          ${row('Usar palabras personalizadas', '', sw(r.useCustom, 'rule-tg', 'data-k="useCustom"'))}
          ${row('Solo favoritas', '', sw(r.favOnly, 'rule-tg', 'data-k="favOnly"'))}
          ${row('Evitar palabras ya salidas', 'Hasta que se agoten.', sw(r.avoidRepeats, 'rule-tg', 'data-k="avoidRepeats"'))}`)}
      </section>
      <div id="valid">${validBox()}</div>
    </main>
    <footer class="bar"><div class="bar-in">${inJam() ? `<button class="btn btn-accent big" data-a="back">Volver a la sala</button>` : `<button class="btn btn-accent big" id="startBtn" data-a="start" ${validation().ok ? '' : 'disabled'}>Empezar partida</button>`}</div></footer>`;
  };
  /* ---------- jugadores y grupos guardados ---------- */
  function playersBlock() {
    const s = setup(), n = s.players.length, groups = Store.groups || [];
    const cur = R.norm(s.players.join('|'));
    return `<section class="sec">
      ${groups.length ? `<div class="sec-h"><h2>Grupos guardados</h2></div>
      <div class="groups">${groups.map(g => {
        const armed = UI.confirm === 'gdel-' + g.id, on = R.norm(g.players.join('|')) === cur;
        return `<div class="grpchip${on ? ' on' : ''}"><button class="grpchip-b" data-a="grp-load" data-id="${g.id}" aria-pressed="${on}"><b>${esc(g.name)}</b><span>${plural(g.players.length, 'jugador', 'jugadores')}</span></button>
          <button class="icon-btn sm${armed ? ' danger-t' : ''}" data-a="${armed ? 'grp-del' : 'arm'}" data-id="${armed ? g.id : 'gdel-' + g.id}" aria-label="${armed ? 'Confirmar borrar' : 'Borrar grupo'} ${esc(g.name)}">${armed ? icon.trash : icon.close}</button></div>`;
      }).join('')}</div>` : ''}
      <div class="sec-h"><h2>Jugadores <span class="count">${n}</span></h2><button class="link" data-a="pl-generic">Nombres genéricos</button></div>
      <ol class="players">${s.players.map((p, i) => `
        <li class="pl"><span class="pl-n">${String(i + 1).padStart(2, '0')}</span>
          <input class="inp" id="pl-${i}" data-in="pl" data-i="${i}" value="${esc(p)}" placeholder="Jugador ${i + 1}" maxlength="20" autocomplete="off" aria-label="Nombre del jugador ${i + 1}">
          <button class="icon-btn sm" data-a="pl-del" data-i="${i}" aria-label="Quitar a ${esc(p || 'Jugador ' + (i + 1))}" ${n <= 3 ? 'disabled' : ''}>${icon.close}</button></li>`).join('')}
      </ol>
      <button class="btn ghost" data-a="pl-add" ${n >= 30 ? 'disabled' : ''}>${icon.plus} Añadir jugador</button>
      <div class="savegrp"><input class="inp" id="grp-name" data-keep="1" maxlength="24" placeholder="Nombre del grupo (p. ej. Los del insti)" aria-label="Nombre del grupo">
        <button class="btn" data-a="grp-save">Guardar grupo</button></div>
    </section>`;
  }
  /* pantalla de nombres que aparece al empezar */
  V.players = () => {
    const v = validation(), plErr = v.errors.filter(e => /jugador|llamados|impostor/i.test(e));
    return header('¿Quién juega?') + `<main class="pad">
      <p class="muted">Se recuerdan los nombres de la última partida. Guarda grupos para cambiar de pandilla con un toque.</p>
      ${playersBlock()}
      ${plErr.length ? `<div class="valid bad"><ul>${plErr.map(e => `<li class="err">${esc(e)}</li>`).join('')}</ul></div>` : ''}
      <button class="link" data-a="nav" data-to="setup">Cambiar modo, reglas o categorías</button>
    </main>
    <footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="pl-next">Siguiente</button></div></footer>`;
  };
  function jamCount() { const j = Store.jam; if (!j) return 0; return (j.hostPlays ? 1 : 0) + j.order.filter(p => !j.kicked.includes(p)).length; }
  function validBox() {
    const v = validation(), p = poolInfo();
    const items = v.errors.map(e => `<li class="err">${esc(e)}</li>`).concat(v.warnings.map(w => `<li class="wrn">${esc(w)}</li>`));
    return `<div class="valid${v.ok ? '' : ' bad'}"><div class="valid-h">${v.ok ? `Lista para jugar · ${plural(p.total, 'palabra disponible', 'palabras disponibles')}` : 'Revisa la configuración'}</div>${items.length ? `<ul>${items.join('')}</ul>` : ''}</div>`;
  }
  function refreshValid() {
    const el = document.getElementById('valid'); if (el) el.innerHTML = validBox();
    const b = document.getElementById('startBtn'); if (b) b.disabled = !validation().ok;
  }

  /* ---------- 4. Selección de categorías ---------- */
  V.cats = () => {
    const s = setup(), cat = catalog(), p = poolInfo();
    const own = cat.filter(c => c.custom), off = cat.filter(c => !c.custom);
    return header('Categorías', { right: `<button class="link" data-a="nav" data-to="words">Editar</button>` }) + `<main class="pad">
      <div class="sec-h"><p class="muted">Toca para activar o desactivar. Los tres puntos abren sus palabras.</p></div>
      <div class="row-btns"><button class="btn ghost sm" data-a="cat-all">Todas</button><button class="btn ghost sm" data-a="cat-none">Ninguna</button><button class="btn ghost sm" data-a="cat-family">Sin +18</button></div>
      ${own.length ? `<h2 class="sub-h">Tus listas</h2><div class="tiles">${own.map(c => tile(c, { on: s.cats.includes(c.id), more: true })).join('')}</div>` : ''}
      <h2 class="sub-h">Categorías incluidas</h2>
      <div class="tiles">${off.map(c => tile(c, { on: s.cats.includes(c.id), more: true })).join('')}</div>
      <button class="btn ghost" data-a="new-list">${icon.plus} Crear lista propia</button>
    </main>
    <footer class="bar"><div class="bar-in">
      <div class="bar-info ${p.total && p.total < 10 ? 'wrn-t' : ''}">${plural(s.cats.length, 'categoría')} · ${plural(p.total, 'palabra')}${p.total && p.total < 10 ? ' · se repetirán' : ''}</div>
      <button class="btn btn-accent" data-a="back">Listo</button></div></footer>`;
  };

  /* ---------- 5. Gestión de palabras ---------- */
  V.words = () => {
    const cat = catalog();
    const own = cat.filter(c => c.custom), off = cat.filter(c => !c.custom);
    const line = c => {
      const act = c.words.filter(w => !w.off && !w.subOff).length, mine = c.words.filter(w => w.user).length, favs = c.words.filter(w => w.fav).length;
      return `<button class="wl" data-a="cat-edit" data-id="${c.id}" style="--c:${catColor(c.h)}"><span class="wl-ab">${esc(c.ab)}</span>
        <span class="wl-tx"><span class="wl-name">${esc(c.name)}</span><span class="wl-meta">${act} activas${mine && !c.custom ? ` · ${mine} tuyas` : ''}${favs ? ` · ${favs} favoritas` : ''}</span></span>
        ${act < 10 ? '<span class="pill wrn-p">Pocas</span>' : ''}</button>`;
    };
    return header('Palabras') + `<main class="pad">
      <div class="sec-h"><h2>Tus listas</h2><button class="link" data-a="new-list">Nueva lista</button></div>
      <div class="wls">${own.length ? own.map(line).join('') : '<p class="muted">Aún no tienes listas propias.</p>'}</div>
      <div class="sec-h"><h2>Categorías incluidas</h2></div>
      <p class="muted small">Puedes añadirles tus palabras, marcar favoritas o desactivar las que no te gusten.</p>
      <div class="wls">${off.map(line).join('')}</div>
    </main>`;
  };

  V.wordEdit = () => {
    const cat = catalog(), c = cat.find(x => x.id === UI.args.id);
    if (!c) return V.words();
    const q = R.norm(UI.wordSearch);
    let words = c.words.filter(w => !q || R.norm(w.w).includes(q) || R.norm(w.sim).includes(q));
    if (UI.wordFilter === 'fav') words = words.filter(w => w.fav);
    if (UI.wordFilter === 'off') words = words.filter(w => w.off);
    if (UI.wordFilter === 'mine') words = words.filter(w => w.user);
    const active = c.words.filter(w => !w.off && !w.subOff).length;
    const cust = c.custom ? Store.custom.find(x => x.id === c.id) : null;
    const wrow = w => {
      const pic = picSrc(w.img, w.data);
      if (UI.editWord === w.key) return `<li class="wr editing">${pic ? picTag(pic, w.w, 'wthumb') : ''}
        <input class="inp" id="ew-w" value="${esc(w.w)}" maxlength="40" aria-label="${pic ? 'Nombre de la imagen' : 'Palabra'}">
        ${pic ? '' : `<input class="inp" id="ew-s" value="${esc(w.sim)}" maxlength="40" placeholder="Parecida (opcional)" aria-label="Palabra parecida">`}
        <div class="wr-act"><button class="btn sm btn-accent" data-a="w-save" data-id="${esc(w.id)}">Guardar</button><button class="btn sm ghost" data-a="w-cancel">Cancelar</button></div></li>`;
      return `<li class="wr${w.off || w.subOff ? ' is-off' : ''}">
        <button class="star${w.fav ? ' on' : ''}" data-a="w-fav" data-k="${esc(w.key)}" aria-label="${w.fav ? 'Quitar de favoritas' : 'Marcar como favorita'}" aria-pressed="${w.fav}">${icon.star}</button>
        ${pic ? picTag(pic, w.w, 'wthumb') : ''}
        <span class="wr-tx"><span class="wr-w">${esc(w.w)}</span>${w.sim ? `<span class="wr-s">parecida: ${esc(w.sim)}</span>` : ''}${pic ? `<span class="wr-s">${w.img ? 'imagen subida' : Caps.jamData ? 'imagen' : 'imagen solo en este móvil'}</span>` : ''}${w.user && !c.custom ? '<span class="pill">tuya</span>' : ''}</span>
        ${w.user ? `<button class="icon-btn sm" data-a="w-edit" data-k="${esc(w.key)}" aria-label="Editar">${icon.edit}</button><button class="icon-btn sm" data-a="w-del" data-id="${esc(w.id)}" aria-label="Borrar">${icon.trash}</button>` : ''}
        ${sw(!w.off, 'w-off', `data-k="${esc(w.key)}" aria-label="Usar ${esc(w.w)}"`)}
      </li>`;
    };
    return header(c.name) + `<main class="pad">
      ${cust ? `<section class="sec">
        <label class="lbl" for="cl-name">Nombre de la lista</label><input class="inp" id="cl-name" data-in="cl-name" value="${esc(cust.name)}" maxlength="30">
        <label class="lbl" for="cl-desc">Descripción</label><input class="inp" id="cl-desc" data-in="cl-desc" value="${esc(cust.desc || '')}" maxlength="80" placeholder="Para qué es esta lista">
        <div class="lbl">Color</div><div class="hues">${[0, 30, 55, 95, 140, 175, 200, 230, 265, 300, 330].map(h => `<button class="hue${cust.h === h ? ' on' : ''}" style="--c:${catColor(h)}" data-a="cl-hue" data-h="${h}" aria-label="Color ${h}"></button>`).join('')}</div>
      </section>` : `<p class="muted">${esc(c.desc)}</p>`}
      ${c.subs.length ? `<section class="sec"><div class="sec-h"><h2>Subcategorías</h2></div>${c.subs.map(sb => row(esc(sb.name), plural(sb.count, 'palabra'), sw(!sb.off, 'sub-off', `data-id="${c.id}/${sb.id}"`))).join('')}</section>` : ''}
      <section class="sec">
        <div class="sec-h"><h2>Añadir palabra</h2><button class="link" data-a="imp-open">${UI.importOpen ? 'Cerrar' : 'Importar varias'}</button></div>
        ${UI.importOpen ? `<div class="import">
          <textarea class="inp ta" id="imp-ta" rows="5" placeholder="Separadas por comas o saltos de línea.&#10;Para indicar la parecida: playa / piscina"></textarea>
          <button class="btn btn-accent" data-a="imp-do">Importar palabras</button></div>` : `
          <div class="addw"><input class="inp" id="nw-w" placeholder="Palabra" maxlength="40" autocomplete="off" aria-label="Nueva palabra">
          <input class="inp" id="nw-s" placeholder="Parecida (opcional)" maxlength="40" autocomplete="off" aria-label="Palabra parecida">
          <button class="btn btn-accent" data-a="w-add">Añadir</button></div>
          <p class="row-d">La parecida se usa en los modos «Palabra parecida» e «Infiltrado».</p>`}
        <div class="imgadd">
          <label class="btn ghost" for="img-in">${icon.plus} ${UI.imgBusy ? 'Procesando imágenes…' : 'Añadir imágenes como palabras'}</label>
          <input type="file" id="img-in" accept="image/png,image/jpeg,image/webp,image/gif" multiple class="vh">
          <p class="row-d">Los jugadores verán la imagen en lugar de una palabra. El nombre del archivo se usa como respuesta (puedes cambiarlo). ${Caps.assets ? 'Se suben a la app para poder usarlas también en sala.' : Caps.jamData ? 'Se guardan en este móvil y, en sala, se envían cifradas a quien le toque.' : 'Se guardan solo en este móvil: sirven para jugar con un móvil, no en sala.'}</p>
        </div>
      </section>
      <section class="sec">
        <div class="sec-h"><h2>Palabras <span class="count">${active}/${c.words.length}</span></h2></div>
        ${active < 10 ? `<p class="note warn">Solo ${plural(active, 'palabra activa', 'palabras activas')}: si juegas solo con esta lista, se repetirán a menudo.</p>` : ''}
        <input class="inp" id="w-search" data-in="w-search" value="${esc(UI.wordSearch)}" placeholder="Buscar" type="search" aria-label="Buscar palabra">
        <div class="seg filt">${[['all', 'Todas'], ['fav', 'Favoritas'], ['off', 'Desactivadas'], ['mine', 'Tuyas']].map(([k, l]) => `<button class="seg-b${UI.wordFilter === k ? ' on' : ''}" data-a="w-filter" data-v="${k}">${l}</button>`).join('')}</div>
        <div class="row-btns"><button class="btn ghost sm" data-a="w-allon">Activar todas</button><button class="btn ghost sm" data-a="w-alloff">Desactivar todas</button></div>
        <ul class="wlist" id="wlist">${words.map(wrow).join('') || '<li class="muted">No hay palabras con este filtro.</li>'}</ul>
      </section>
      ${cust ? `<section class="sec">${confirmBtn('del-list', 'Borrar esta lista', '¿Borrar la lista y sus palabras? Toca otra vez', 'cl-del', 'danger')}</section>` : ''}
    </main>`;
  };

  /* ---------- explicación del modo antes de repartir ---------- */
  V.intro = () => {
    const s = setup(), m = R.modeById(s.mode), r = s.rules;
    const facts = [
      plural(s.players.length, 'jugador', 'jugadores') + ' · ' + impLabel(s) + (r.randomImpostors ? (r.knowEachOther ? ' (se conocen entre ellos)' : ' (no se conocen entre ellos)') : ''),
      `${plural(r.clueRounds, 'ronda', 'rondas')} de ${r.turnStyle === 'preguntas' ? 'preguntas' : 'pistas'} antes de votar` + (r.turnStyle === 'pistas' && r.clueType !== 'libre' ? ` (${R.CLUE_TYPES[r.clueType].label.toLowerCase()})` : ''),
      r.maxRounds ? `Máximo ${plural(r.maxRounds, 'votación', 'votaciones')}` : 'Se vota hasta que gane un bando',
      r.voting === 'group' ? 'Votación en grupo' : 'Voto secreto pasando el móvil',
      r.guess === 'win' ? 'El impostor descubierto puede ganar si adivina la palabra' : r.guess === 'partial' ? 'El impostor descubierto puede lograr una victoria parcial' : '',
      r.timers.clue || r.timers.debate || r.timers.vote ? 'Con tiempo: ' + [r.timers.clue && `pista ${fmtTime(r.timers.clue)}`, r.timers.debate && `debate ${fmtTime(r.timers.debate)}`, r.timers.vote && r.voting === 'group' && `voto ${fmtTime(r.timers.vote)}`].filter(Boolean).join(', ') : '',
      r.maxClues ? `${plural(r.maxClues, 'pista', 'pistas')} por jugador en toda la partida` : ''
    ].filter(Boolean);
    return header('Antes de empezar') + `<main class="pad intro">
      <div class="intro-n">Modo ${String(m.n).padStart(2, '0')}</div>
      <h2 class="intro-t">${esc(m.name)}</h2>
      <p class="intro-how">${esc(m.how)}</p>
      <ul class="facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      <div class="note">Ahora el móvil irá pasando de mano en mano. Cada uno mira su papel sin que lo vean los demás y lo oculta antes de pasarlo.</div>
    </main>
    <footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="deal">Repartir papeles</button></div></footer>`;
  };

  /* ---------- 6. Revelación privada ---------- */
  V.reveal = () => {
    const g = Store.game, i = g.revealIdx, p = g.players[i], n = g.players.length;
    const exp = `Expediente ${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
    const top = header('Papeles', { backAct: 'quit-ask', right: `<span class="hd-meta">${i + 1}/${n}</span>` });
    if (g.revealStep !== 'card') {
      return top + `<main class="pad pass">
        <div class="pass-k">${exp}</div>
        <p class="pass-l">Pasa el móvil a</p>
        <div class="pass-name">${esc(p.name)}</div>
        <p class="muted">Que nadie más mire la pantalla.</p>
        <div class="dots">${g.players.map((_, j) => `<span class="${j < i ? 'done' : j === i ? 'cur' : ''}"></span>`).join('')}</div>
        ${quitBox()}
      </main>
      <footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="rv-me">Soy ${esc(p.name)}: ver mi papel</button></div></footer>`;
    }
    const card = R.cardFor(g, i), hold = Store.settings.revealStyle === 'hold';
    const back = cardBack(card);
    return top + `<main class="pad reveal">
      <div class="card${g.cardOpen ? ' open' : ''}${card.kind === 'impostor' ? ' is-imp' : ''}" id="card">
        <button class="card-in" id="cardBtn" ${hold ? 'data-hold="1"' : 'data-a="rv-flip"'} aria-label="${hold ? 'Mantén pulsado para ver tu papel' : 'Toca para ver tu papel'}">
          <span class="face front">
            <span class="cf-k">${exp}</span>
            <span class="cf-name">${esc(p.name)}</span>
            <span class="seal">Confidencial</span>
            <span class="cf-hint">${hold ? 'Mantén pulsado para ver' : 'Toca para abrir'}</span>
          </span>
          <span class="face backf">${back}</span>
        </button>
      </div>
      <p class="muted center small">${hold ? 'Al soltar, la tarjeta se cierra.' : 'Toca la tarjeta de nuevo para cerrarla.'}</p>
    </main>
    <footer class="bar"><div class="bar-in"><button class="btn big ${g.cardSeen ? 'btn-accent' : ''}" data-a="rv-done" ${g.cardSeen ? '' : 'disabled'}>${i + 1 < n ? 'Ocultar y pasar' : 'Ocultar y empezar'}</button></div></footer>`;
  };
  function quitBox() {
    if (UI.confirm !== 'quit') return '';
    return `<div class="quit"><p>¿Abandonar la partida? No contará en las estadísticas.</p><div class="row-btns"><button class="btn danger" data-a="quit">Abandonar</button><button class="btn ghost" data-a="unarm">Seguir jugando</button></div></div>`;
  }

  /* ---------- 7. Pistas y turnos ---------- */
  V.clues = () => {
    const g = Store.game, r = g.rules;
    const order = g.order, t = g.turn, idx = order[t], p = g.players[idx];
    const askMode = r.turnStyle === 'preguntas';
    const target = askMode ? g.players[R.questionTarget(g, order, t)] : null;
    const noClues = r.maxClues > 0 && p.cluesLeft <= 0;
    const cond = g.cond;
    return header(askMode ? 'Preguntas' : 'Pistas', { backAct: 'quit-ask', right: `<span class="hd-meta">Votación ${g.round}${r.maxRounds ? '/' + r.maxRounds : ''}</span>` }) + `<main class="pad clue">
      <div class="clue-meta"><span>Ronda ${g.clueRound} de ${r.clueRounds}</span><span>Turno ${t + 1} de ${order.length}</span></div>
      ${cond ? `<div class="cond"><span class="cond-k">Condición</span><b>${esc(cond.label)}</b><span>${esc(cond.hint)}</span>${cond.type === 'pregunta' ? `<span class="cond-q">${esc(g.q)}</span>` : ''}</div>` : ''}
      <div class="turn">
        ${askMode ? `<div class="turn-l">Pregunta</div><div class="turn-name">${esc(p.name)}</div><div class="turn-l">a</div><div class="turn-name t2">${esc(target.name)}</div>
          <div class="sugg"><span class="cond-k">Idea de pregunta</span><span>${esc(g.q)}</span><button class="link" data-a="new-q">Otra</button></div>`
        : `<div class="turn-l">Turno de</div><div class="turn-name">${esc(p.name)}</div>`}
        ${r.maxClues ? `<div class="pill ${noClues ? 'wrn-p' : ''}">${noClues ? 'Sin pistas restantes' : `Le ${p.cluesLeft === 1 ? 'queda 1 pista' : `quedan ${p.cluesLeft} pistas`}`}</div>` : ''}
      </div>
      ${r.timers.clue && !noClues ? timerHtml(r.timers.clue) : ''}
      ${r.registerClues && !noClues ? `<div class="regc"><label class="lbl" for="clue-in">${askMode ? 'Anota la respuesta' : 'Anota la pista'}</label><input class="inp" id="clue-in" maxlength="60" autocomplete="off" placeholder="Opcional"></div>` : ''}
      <ol class="order">${order.map((j, k) => `<li class="${k < t ? 'done' : k === t ? 'cur' : ''}">${esc(g.players[j].name)}</li>`).join('')}</ol>
      ${quitBox()}
    </main>
    <footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="clue-next">${noClues ? 'Pasar turno' : t + 1 < order.length ? 'Siguiente' : g.clueRound < r.clueRounds ? 'Siguiente ronda' : 'Ir al debate'}</button></div></footer>`;
  };
  function timerHtml(total) {
    return `<div class="timer" id="timer" data-total="${total}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="tr-bg"/><circle cx="60" cy="60" r="52" class="tr-fg" id="tr-fg" pathLength="100"/></svg>
      <div class="timer-v" id="timer-v">${fmtTime(total)}</div>
      <button class="icon-btn sm timer-p" data-a="timer-pause" aria-label="${Store.game && Store.game.timerPausedLeft != null ? 'Reanudar' : 'Pausar'}">${Store.game && Store.game.timerPausedLeft != null ? icon.play : icon.pause}</button></div>`;
  }

  /* ---------- 8. Debate y votación ---------- */
  V.debate = () => {
    const g = Store.game, r = g.rules;
    const alive = g.players.map((p, i) => [p, i]).filter(([p]) => p.alive);
    const clues = g.clues.filter(c => c.round === g.round);
    return header('Debate', { backAct: 'quit-ask', right: `<span class="hd-meta">Votación ${g.round}${r.maxRounds ? '/' + r.maxRounds : ''}</span>` }) + `<main class="pad">
      <h2 class="big-h">¿Quién no sabía de qué hablaba?</h2>
      <p class="muted">Repasad las pistas, buscad contradicciones y acusad con argumentos.</p>
      ${r.timers.debate ? timerHtml(r.timers.debate) : ''}
      ${clues.length ? `<section class="sec"><div class="sec-h"><h2>Pistas anotadas</h2></div><ul class="cluelog">${clues.map(c => `<li><b>${esc(g.players[c.idx].name)}</b><span>${esc(c.text)}</span>${c.flag ? `<span class="pill wrn-p">${esc(c.flag)}</span>` : ''}</li>`).join('')}</ul></section>` : ''}
      <section class="sec"><div class="sec-h"><h2>Siguen en juego <span class="count">${alive.length}</span></h2></div>
        <div class="chips">${alive.map(([p]) => `<span class="chip plain">${esc(p.name)}</span>`).join('')}</div></section>
      ${quitBox()}
    </main>
    <footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="to-vote">Votar</button></div></footer>`;
  };

  V.vote = () => {
    const g = Store.game, r = g.rules, v = g.vote;
    const top = header('Votación', { backAct: 'quit-ask', right: `<span class="hd-meta">${g.round}${r.maxRounds ? '/' + r.maxRounds : ''}</span>` });
    if (r.voting === 'group') {
      const alive = g.players.map((p, i) => [p, i]).filter(([p]) => p.alive);
      return top + `<main class="pad">
        <h2 class="big-h">¿A quién echáis?</h2>
        <p class="muted">Poneos de acuerdo (o votad a mano alzada) y elegid a una persona.</p>
        ${r.timers.vote ? timerHtml(r.timers.vote) : ''}
        <div class="vgrid">${alive.map(([p, i]) => `<button class="vbtn${v.sel === i ? ' on' : ''}" data-a="v-sel" data-i="${i}" aria-pressed="${v.sel === i}">${esc(p.name)}</button>`).join('')}</div>
        <button class="btn ghost" data-a="v-sel" data-i="-1" aria-pressed="${v.sel === -1}">${v.sel === -1 ? '✓ ' : ''}No echar a nadie esta vez</button>
        ${quitBox()}
      </main>
      <footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="v-confirm" ${v.sel == null ? 'disabled' : ''}>${v.sel == null ? 'Elige a alguien' : v.sel === -1 ? 'Confirmar: nadie sale' : `Echar a ${esc(g.players[v.sel].name)}`}</button></div></footer>`;
    }
    // voto secreto
    const voter = g.players[v.voters[v.i]];
    if (v.step === 'pass') return top + `<main class="pad pass">
      <div class="pass-k">${v.revoted ? 'Desempate · ' : ''}Voto ${v.i + 1} de ${v.voters.length}</div>
      <p class="pass-l">Pasa el móvil a</p><div class="pass-name">${esc(voter.name)}</div>
      <p class="muted">Vota en secreto. Nadie más debe mirar.</p>
      ${v.revoted ? `<p class="note">Empate entre ${v.candidates.map(i => esc(g.players[i].name)).join(' y ')}. Solo se puede votar a ellos.</p>` : ''}
      ${quitBox()}
    </main><footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="sv-open">Soy ${esc(voter.name)}: votar</button></div></footer>`;
    const opts = v.candidates.filter(i => i !== v.voters[v.i]);
    return top + `<main class="pad">
      <h2 class="big-h">${esc(voter.name)}, ¿quién es el impostor?</h2>
      <div class="vgrid">${opts.map(i => `<button class="vbtn" data-a="sv-cast" data-i="${i}">${esc(g.players[i].name)}</button>`).join('')}</div>
      <button class="btn ghost" data-a="sv-cast" data-i="-1">Votar en blanco</button>
    </main>`;
  };

  /* resultado de la votación + última oportunidad */
  V.voteResult = () => {
    const g = Store.game, lv = g.lastVote, r = g.rules;
    const p = lv.eliminated != null ? g.players[lv.eliminated] : null;
    const wasImp = p && p.role === 'impostor';
    const showRole = p && (r.revealOnElim || (wasImp && r.guess !== 'off'));
    const counts = lv.counts && Object.keys(lv.counts).length ? Object.entries(lv.counts).sort((a, b) => b[1] - a[1]).map(([i, c]) => `<li><span>${esc(g.players[i].name)}</span><b>${c}</b></li>`).join('') : '';
    let body;
    if (!p) body = `<h2 class="big-h">Nadie sale esta vez</h2><p class="muted">${esc(lv.reason || 'No hubo mayoría.')}</p>`;
    else body = `<div class="pass-l">${esc(lv.reason || 'Habéis decidido')}</div><div class="pass-name">${esc(p.name)}</div><p class="muted">queda fuera de la partida</p>
      ${showRole ? `<div class="verdict ${wasImp ? 'imp' : 'crew'}">${wasImp ? (r.impostorInfo === 'unaware' ? 'Era el infiltrado' : 'Era impostor') : 'Era inocente'}</div>` : '<p class="note">Su papel se revelará al final.</p>'}`;
    let guess = '';
    if (g.guessState === 'pending') guess = `<section class="sec guess">
      <div class="sec-h"><h2>Última oportunidad</h2></div>
      <p>${esc(p.name)} puede intentar adivinar la palabra secreta${r.guess === 'win' ? ' y ganar la partida' : ' para conseguir una victoria parcial'}.</p>
      <div class="addw"><input class="inp" id="guess-in" placeholder="Escribe la palabra" autocomplete="off" aria-label="Intento de adivinar"><button class="btn btn-accent" data-a="g-check">Comprobar</button></div>
      <div class="row-btns"><button class="btn ghost sm" data-a="g-manual" data-v="1">Lo ha dicho en voz alta y acierta</button><button class="btn ghost sm" data-a="g-manual" data-v="0">Ha fallado</button></div>
    </section>`;
    else if (g.guessState === 'right') guess = `<div class="verdict imp">¡Ha adivinado la palabra!</div>`;
    else if (g.guessState === 'wrong') guess = `<p class="note">No ha acertado la palabra.</p>`;
    return header('Veredicto', { backAct: 'quit-ask' }) + `<main class="pad pass">${body}
      ${counts ? `<ul class="tally">${counts}</ul>` : ''}${guess}${statusLine(g)}${quitBox()}</main>
      <footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="vr-next" ${g.guessState === 'pending' ? 'disabled' : ''}>Continuar</button></div></footer>`;
  };

  /* ---------- 9. Final ---------- */
  V.end = () => {
    const g = Store.game, res = g.result, r = g.rules;
    const crewWin = res.winner === 'crew';
    const reasonTxt = {
      caught: 'Habéis descubierto a todos los impostores.',
      numbers: r.winRule === 'parity' ? 'Los impostores han igualado en número a los demás.' : 'Los impostores superan en número a los demás.',
      survived: 'Se acabaron las votaciones y algún impostor sigue dentro.',
      guess: 'El impostor descubierto ha adivinado la palabra.',
      timeout: 'Se agotó el tiempo de votación.'
    }[res.reason] || '';
    const elims = g.events.filter(e => e.t === 'elim');
    const mins = Math.max(1, Math.round((res.endedAt - g.startedAt) / 60000));
    return header('Fin de la partida', { noBack: true }) + `<main class="pad end">
      <div class="win ${crewWin ? 'crew' : 'imp'}"><div class="win-k">Ganan</div><div class="win-t">${crewWin ? 'Los jugadores' : (r.impostorInfo === 'unaware' ? 'Los infiltrados' : (r.impostors > 1 ? 'Los impostores' : 'El impostor'))}</div><p>${esc(reasonTxt)}</p></div>
      ${g.partial.length ? `<p class="note">Victoria parcial para ${g.partial.map(i => esc(g.players[i].name)).join(', ')}: adivinó la palabra al ser descubierto.</p>` : ''}
      ${secretBlock(g.secret.w, picSrc(g.secret.img, g.secret.data), g.secret.catName, g.secret.imp, picSrc(g.secret.impImg, g.secret.impData))}
      <section class="sec"><div class="sec-h"><h2>Papeles</h2></div>
        <ul class="roles">${g.players.map(p => `<li class="${p.role}"><span class="rl-n">${esc(p.name)}</span><span class="rl-r">${p.role === 'impostor' ? (r.impostorInfo === 'unaware' ? 'Infiltrado' : 'Impostor') : 'Jugador'}</span><span class="rl-s">${p.alive ? 'Sigue' : 'Fuera'}</span></li>`).join('')}</ul></section>
      <section class="sec"><div class="sec-h"><h2>Resumen</h2></div>
        <ul class="summary">
          <li>${esc(R.modeById(g.mode).name)} · ${plural(g.round, 'votación', 'votaciones')} · ${mins} min</li>
          ${elims.map(e => `<li>Votación ${e.round}: fuera ${esc(g.players[e.idx].name)} (${e.role === 'impostor' ? 'impostor' : 'inocente'})</li>`).join('')}
          ${g.clues.length ? `<li>${plural(g.clues.length, 'pista anotada', 'pistas anotadas')}</li>` : ''}
        </ul></section>
    </main>
    <footer class="bar"><div class="bar-in two"><button class="btn" data-a="end-setup">Cambiar ajustes</button><button class="btn btn-accent" data-a="rematch">Revancha</button></div></footer>`;
  };

  /* ---------- 10. Estadísticas ---------- */
  V.stats = () => {
    const h = Store.history;
    const head = header('Estadísticas');
    if (!Store.settings.stats && !h.length) return head + `<main class="pad"><p class="muted">Las estadísticas están desactivadas.</p><button class="btn" data-a="nav" data-to="settings">Ir a ajustes</button></main>`;
    if (!h.length) return head + `<main class="pad empty"><div class="stamp-deco sm" aria-hidden="true">0</div><h2 class="big-h">Aún no hay partidas</h2><p class="muted">Cuando terminéis la primera, aquí verás quién gana más, quién sale de impostor y qué palabras han salido.</p><button class="btn btn-accent" data-a="quick">Jugar una partida</button></main>`;
    const impW = h.filter(x => x.winner === 'impostors').length, crewW = h.length - impW;
    const pct = Math.round(impW / h.length * 100);
    const ps = Object.values(Store.playerStats).sort((a, b) => b.wins - a.wins || b.games - a.games);
    const catCount = {}; h.forEach(x => { catCount[x.cat] = (catCount[x.cat] || 0) + 1; });
    const cats = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 6), maxC = cats.length ? cats[0][1] : 1;
    return head + `<main class="pad stats">
      ${Store.settings.stats ? '' : '<p class="note">Las estadísticas están desactivadas: no se registran partidas nuevas.</p>'}
      <div class="kpis">
        <div class="kpi"><span class="kpi-v">${h.length}</span><span class="kpi-l">partidas</span></div>
        <div class="kpi"><span class="kpi-v crew-t">${crewW}</span><span class="kpi-l">ganan jugadores</span></div>
        <div class="kpi"><span class="kpi-v imp-t">${impW}</span><span class="kpi-l">ganan impostores</span></div>
      </div>
      <div class="split" aria-label="${pct}% de victorias de impostores"><span class="split-c" style="width:${100 - pct}%"></span><span class="split-i" style="width:${pct}%"></span></div>
      <section class="sec"><div class="sec-h"><h2>Jugadores</h2></div>
        <div class="tbl-w"><table class="tbl"><thead><tr><th>Nombre</th><th>Partidas</th><th>Impostor</th><th>Victorias</th><th>Racha</th><th>Mejor</th></tr></thead>
        <tbody>${ps.map(p => `<tr><td>${esc(p.name)}</td><td>${p.games}</td><td>${p.imp}</td><td>${p.wins}</td><td>${p.streak}</td><td>${p.best}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="sec"><div class="sec-h"><h2>Categorías más jugadas</h2></div>
        <ul class="bars">${cats.map(([c, n]) => `<li><span class="bars-l">${esc(c)}</span><span class="bars-t"><span style="width:${n / maxC * 100}%"></span></span><b>${n}</b></li>`).join('')}</ul></section>
      <section class="sec"><div class="sec-h"><h2>Palabras que han salido</h2></div>
        <div class="chips">${[...new Set(h.map(x => x.word))].slice(0, 60).map(w => `<span class="chip plain">${esc(w)}</span>`).join('')}</div></section>
      <section class="sec"><div class="sec-h"><h2>Historial</h2></div>
        <ul class="hist">${h.slice(0, 40).map(x => `<li><div class="hist-t"><b class="${x.winner === 'crew' ? 'crew-t' : 'imp-t'}">${x.winner === 'crew' ? 'Ganan jugadores' : 'Ganan impostores'}</b><span>${esc(x.word)}</span></div>
          <div class="hist-m">${fmtDate(x.date)} · ${esc(x.mode)} · impostor: ${esc(x.impostors.join(', '))}</div></li>`).join('')}</ul></section>
      ${confirmBtn('reset-stats', 'Borrar estadísticas', '¿Borrar todo el historial? Toca otra vez', 'stats-reset', 'danger')}
    </main>`;
  };

  /* ---------- 11. Ajustes ---------- */
  V.settings = () => {
    const st = Store.settings;
    const sseg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="seg-b${st[k] === v ? ' on' : ''}" data-a="set" data-k="${k}" data-v="${v}" aria-pressed="${st[k] === v}">${l}</button>`).join('')}</div>`;
    return header('Ajustes') + `<main class="pad">
      <section class="sec"><div class="rule-b"><div class="row-l">Tema</div>${sseg('theme', [['dark', 'Oscuro'], ['light', 'Claro'], ['system', 'Del sistema']])}</div>
        <div class="rule-b"><div class="row-l">Ver el papel</div>${sseg('revealStyle', [['tap', 'Tocar para abrir'], ['hold', 'Mantener pulsado']])}<div class="row-d">«Mantener pulsado» cierra la tarjeta en cuanto sueltas el dedo.</div></div>
        ${row('Sonidos', 'Al tocar botones, revelar papeles, votar y al acabarse el tiempo.', sw(st.sound !== false, 'set-tg', 'data-k="sound"'))}
        ${row('Vibración', 'Al revelar papeles y al acabarse el tiempo.', sw(st.vibrate, 'set-tg', 'data-k="vibrate"'))}
        ${row('Guardar estadísticas', 'Historial, victorias y rachas.', sw(st.stats, 'set-tg', 'data-k="stats"'))}</section>
      <section class="sec"><div class="sec-h"><h2>Datos</h2></div>
        <p class="muted small">Todo se guarda solo en este dispositivo. ${plural(Store.used.length, 'palabra ya salida', 'palabras ya salidas')}.</p>
        <div class="stack">
          ${confirmBtn('clear-used', 'Olvidar palabras ya salidas', 'Toca otra vez para confirmar', 'clear-used', '')}
          ${confirmBtn('reset-words', 'Restaurar palabras incluidas', 'Se borran tus cambios en las categorías incluidas. Confirmar', 'reset-words', '')}
          <button class="btn" data-a="backup">Copiar copia de seguridad</button>
          <button class="btn" data-a="restore-open">Restaurar copia de seguridad</button>
          ${UI.restoreOpen ? `<textarea class="inp ta" id="restore-ta" rows="4" placeholder="Pega aquí la copia de seguridad"></textarea><button class="btn btn-accent" data-a="restore-do">Restaurar</button>` : ''}
          ${confirmBtn('wipe', 'Borrar todos los datos', 'Se borra todo: listas, palabras y estadísticas. Confirmar', 'wipe', 'danger')}
        </div></section>
    </main>`;
  };

  /* ---------- Cómo se juega ---------- */
  V.help = () => header('Cómo se juega') + `<main class="pad help">
    <ol class="steps">
      <li><b>Preparad la partida.</b> Nombres, número de impostores, modo y categorías.</li>
      <li><b>Pasad el móvil.</b> Cada jugador abre su tarjeta en privado: los normales ven la palabra secreta; el impostor no.</li>
      <li><b>Pistas.</b> Por turnos, cada uno dice algo relacionado con la palabra. Ni muy obvio (el impostor la adivinaría) ni muy raro (pareceríais el impostor).</li>
      <li><b>Debate y votación.</b> Buscad contradicciones y echad a quien creáis impostor.</li>
      <li><b>Victoria.</b> Los jugadores ganan si echan a todos los impostores. Los impostores, si llegan a igualarlos en número o sobreviven a todas las votaciones.</li>
    </ol>
    <h2 class="sub-h">Los 13 modos</h2>
    <div class="modes">${R.MODES.map(m => `<div class="mode static"><span class="mode-n">${String(m.n).padStart(2, '0')}</span><span class="mode-tx"><span class="mode-name">${esc(m.name)}</span><span class="mode-how">${esc(m.how)}</span></span></div>`).join('')}</div>
  </main>`;

  /* =========================================================
     LÓGICA DE PARTIDA (conecta la interfaz con Rules)
     ========================================================= */
  function startGame() {
    const s = setup();
    s.players = s.players.map((p, i) => p.trim() || `Jugador ${i + 1}`);
    Store.players = s.players.slice();
    const info = poolInfo();
    if (info.recycled) {
      const keys = new Set(info.pool.map(p => p.key));
      Store.used = Store.used.filter(k => !keys.has(k));
    }
    const g = R.createGame(s, info.pool, undefined, info.alts);
    g.revealStep = 'pass'; g.cardOpen = false; g.cardSeen = false;
    Store.game = g;
    requestWake();
    go('reveal', {}, true); UI.stack = [];
  }
  function startClueRound() {
    const g = Store.game, r = g.rules;
    g.phase = 'clues'; g.order = R.turnOrder(g); g.turn = 0;
    g.cond = r.turnStyle === 'pistas' && r.clueType !== 'libre' ? R.clueCondition(r) : null;
    g.q = pickQ();
    startTimer('clue');
  }
  function curTurnHasClues() { const g = Store.game; const p = g.players[g.order[g.turn]]; return !(g.rules.maxClues > 0 && p.cluesLeft <= 0); }
  function nextTurn(skipped) {
    const g = Store.game, r = g.rules, idx = g.order[g.turn], p = g.players[idx];
    if (curTurnHasClues()) {
      const inp = document.getElementById('clue-in');
      const text = inp ? inp.value.trim() : '';
      if (r.maxClues > 0) p.cluesLeft--;
      if (text) {
        const chk = R.checkClue(g, idx, text);
        let flag = chk.obvious ? 'Dice la palabra' : chk.repeat ? 'Repetida' : '';
        if (flag && r.cluePenalty !== 'none') {
          if (r.cluePenalty === 'lose') { if (r.maxClues > 0) p.cluesLeft = Math.max(0, p.cluesLeft - 1); p.penalties++; toast(`${flag === 'Repetida' ? 'Pista repetida' : 'Pista demasiado evidente'}: ${p.name} pierde una pista.`, 'warn'); }
          else toast(flag === 'Repetida' ? 'Esa pista ya se ha dicho.' : 'Cuidado: la pista contiene la palabra.', 'warn');
        } else if (r.cluePenalty === 'none') flag = '';
        g.clues.push({ idx, text, round: g.round, flag });
      } else if (skipped) g.clues.push({ idx, text: '(sin pista: tiempo agotado)', round: g.round, flag: '' });
    }
    g.turn++; g.timerPausedLeft = null;
    if (g.turn >= g.order.length) {
      if (g.clueRound < r.clueRounds) { g.clueRound++; startClueRound(); }
      else { g.clueRound = 1; g.phase = 'debate'; startTimer('debate'); }
    } else { g.q = pickQ(); startTimer('clue'); }
    render(true);
  }
  function startVote() {
    const g = Store.game, r = g.rules;
    g.phase = 'vote'; g.timerPausedLeft = null;
    const alive = g.players.map((p, i) => p.alive ? i : -1).filter(i => i >= 0);
    if (r.voting === 'group') { g.vote = { sel: null }; startTimer('vote'); }
    else { g.vote = { voters: R.shuffle(alive, rng), i: 0, step: 'pass', votes: [], candidates: alive, revoted: false }; stopTimer(); }
    render(true);
  }
  function resolveVote(elimIdx, extra = {}) {
    const g = Store.game, r = g.rules;
    stopTimer();
    g.lastVote = Object.assign({ eliminated: elimIdx }, extra);
    g.guessState = null;
    if (elimIdx != null) {
      const wasImp = R.eliminate(g, elimIdx);
      if (wasImp && r.guess !== 'off') g.guessState = 'pending';
    }
    g.phase = 'voteResult';
    vibrate(60); Sound.play(elimIdx != null ? 'out' : 'tap');
    render(true);
  }
  function afterVote() {
    const g = Store.game;
    const res = R.checkWin(g);
    if (res) return finish(res);
    g.round++; g.clueRound = 1;
    startClueRound(); render(true);
  }
  function finish(res) {
    const g = Store.game;
    g.result = Object.assign({ endedAt: Date.now() }, res);
    g.phase = 'end'; stopTimer(); releaseWake();
    recordStats(g, res);
    vibrate([80, 60, 160]); Sound.play(res.winner === 'crew' ? 'win' : 'lose');
    render(true);
  }
  function recordStats(g, res) {
    // palabras usadas (siempre, para evitar repeticiones)
    Store.used.push(g.secret.key); if (Store.used.length > 3000) Store.used = Store.used.slice(-3000);
    if (Store.settings.stats) {
      Store.history.unshift({ date: g.result.endedAt, mode: R.modeById(g.mode).name, word: g.secret.w, cat: g.secret.catName, winner: res.winner,
        impostors: g.players.filter(p => p.role === 'impostor').map(p => p.name), players: g.players.map(p => ({ n: p.name, r: p.role })), rounds: g.round });
      if (Store.history.length > 300) Store.history.length = 300;
      g.players.forEach(p => {
        const k = R.norm(p.name); const s = Store.playerStats[k] || { name: p.name, games: 0, imp: 0, wins: 0, streak: 0, best: 0 };
        s.name = p.name; s.games++; if (p.role === 'impostor') s.imp++;
        const won = (p.role === 'impostor') === (res.winner === 'impostors');
        if (won) { s.wins++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
        Store.playerStats[k] = s;
      });
    }
  }

  /* ---------- temporizador ---------- */
  let tick = null;
  function startTimer(kind) {
    const g = Store.game, secs = g.rules.timers[kind];
    if (kind === 'vote' && g.rules.voting !== 'group') return stopTimer();
    if (!secs || (kind === 'clue' && !curTurnHasClues())) { g.timerEnd = null; g.timerKind = null; return; }
    g.timerKind = kind; g.timerEnd = Date.now() + secs * 1000; g.timerTotal = secs; g.timerPausedLeft = null;
  }
  function stopTimer() { const g = Store.game; if (g) { g.timerEnd = null; g.timerKind = null; g.timerPausedLeft = null; } }
  function onTimeout(kind) {
    const g = Store.game;
    vibrate([200, 80, 200]);
    if (kind === 'clue') { toast('Se acabó el tiempo: turno perdido.', 'warn'); nextTurn(true); }
    else if (kind === 'debate') { toast('Se acabó el debate. ¡A votar!'); startVote(); }
    else if (kind === 'vote') {
      const pen = g.rules.timeoutPenalty;
      if (pen === 'impostors') { g.forcedWinner = 'impostors'; g.forcedReason = 'timeout'; stopTimer(); finish(R.checkWin(g)); }
      else if (pen === 'random') { const alive = g.players.map((p, i) => p.alive ? i : -1).filter(i => i >= 0); resolveVote(alive[Math.floor(rng() * alive.length)], { reason: 'Tiempo agotado: el azar ha elegido a' }); }
      else resolveVote(null, { reason: 'Se agotó el tiempo sin decidir.' });
    }
  }
  function timerLoop() {
    const g = Store.game;
    const el = document.getElementById('timer');
    if (!g || !g.timerEnd || !el) return;
    const left = g.timerPausedLeft != null ? g.timerPausedLeft : Math.max(0, Math.ceil((g.timerEnd - Date.now()) / 1000));
    const v = document.getElementById('timer-v'), fg = document.getElementById('tr-fg');
    if (v) v.textContent = fmtTime(left);
    if (fg) fg.style.strokeDashoffset = String(100 - (left / g.timerTotal) * 100);
    el.classList.toggle('low', left <= 5);
    if (left <= 5 && left > 0 && g.timerPausedLeft == null && timerLoop.last !== left) Sound.play('tick');
    timerLoop.last = left;
    if (left <= 0 && g.timerPausedLeft == null) { const k = g.timerKind; g.timerEnd = null; Sound.play('alarm'); onTimeout(k); }
  }
  tick = setInterval(timerLoop, 250);

  /* ---------- pantalla encendida ---------- */
  let wake = null;
  async function requestWake() { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) {} wake = null; }

  /* ---------- palabras: helpers de edición ---------- */
  function catWordsArr(catId) {
    const cust = Store.custom.find(c => c.id === catId);
    if (cust) return cust.words;
    if (!Store.added[catId]) Store.added[catId] = [];
    return Store.added[catId];
  }
  function addWord(catId, w, sim) {
    w = String(w || '').trim().slice(0, 40); sim = String(sim || '').trim().slice(0, 40);
    if (!w) return 'empty';
    const c = catalog().find(x => x.id === catId);
    const k = R.keyOf(catId, w);
    if (c.words.some(x => x.key === k)) return 'dup';
    catWordsArr(catId).push({ id: uid(), w, sim });
    return 'ok';
  }
  /* reduce la imagen: copia ligera para guardar en el móvil o archivo para subir */
  async function shrink(file, max, q) {
    const url = URL.createObjectURL(file);
    try {
      const im = new Image(); im.src = url; await im.decode();
      const sc = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * sc)); c.height = Math.max(1, Math.round(im.naturalHeight * sc));
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(im, 0, 0, c.width, c.height);
      return { data: c.toDataURL('image/jpeg', q), blob: await new Promise(r => c.toBlob(r, 'image/jpeg', q)) };
    } finally { URL.revokeObjectURL(url); }
  }
  async function addImages(files) {
    const catId = UI.args.id; let ok = 0, fail = 0, local = 0;
    UI.imgBusy = true; render();
    for (const f of files) {
      if (!/^image\//.test(f.type)) { fail++; continue; }
      const label = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Imagen';
      try {
        const item = { id: uid(), w: label, sim: '' };
        let uploaded = false;
        if (Caps.assets) {
          try { const big = await shrink(f, 1000, 0.82); const r = await Caps.assets.upload(big.blob, { type: 'image/jpeg' }); item.img = r.id; uploaded = true; } catch (e) {}
        }
        if (!uploaded) { const small = await shrink(f, 420, 0.7); item.data = small.data; local++; }
        catWordsArr(catId).push(item); ok++;
        save();
        if (!storageOk) { catWordsArr(catId).pop(); storageOk = true; save(); fail++; ok--; toast('No queda espacio en este móvil para más imágenes.', 'warn'); break; }
      } catch (e) { fail++; }
    }
    UI.imgBusy = false; render();
    toast(`${plural(ok, 'imagen añadida', 'imágenes añadidas')}${fail ? ` · ${fail} no se pudieron leer` : ''}${local && Caps.assets ? ' · algunas no se subieron: quedan solo en este móvil' : ''}.`, fail ? 'warn' : '');
  }
  function parseBulk(text) {
    return String(text || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).map(s => {
      const m = s.split(/\s+\/\s+|\|/); return { w: m[0].trim(), sim: (m[1] || '').trim() };
    });
  }
  function setWordState(key, prop, val) {
    const s = Store.wordState[key] || {}; s[prop] = val;
    if (!s.off && !s.fav) delete Store.wordState[key]; else Store.wordState[key] = s;
  }

  /* =========================================================
     ACCIONES
     ========================================================= */
  const A = {
    nav: el => go(el.dataset.to, {}, el.dataset.replace === '1'),
    back,
    arm: el => { UI.confirm = el.dataset.id; render(); },
    unarm: () => { UI.confirm = null; render(); },
    quick: () => go('players'),
    'pl-next': () => {
      const s = setup(); s.players = s.players.map((p, i) => p.trim() || `Jugador ${i + 1}`); fitImpostors(); Store.players = s.players.slice();
      const v = validation();
      if (v.ok) go('intro'); else { go('setup'); toast(v.errors[0], 'warn'); }
    },
    'grp-load': el => { const g = (Store.groups || []).find(x => x.id === el.dataset.id); if (!g) return; const s = setup(); s.players = g.players.slice(); fitImpostors(); render(); toast(`Grupo «${g.name}» cargado.`); },
    'grp-del': el => { Store.groups = (Store.groups || []).filter(x => x.id !== el.dataset.id); UI.confirm = null; render(); toast('Grupo borrado.'); },
    'grp-save': () => {
      const inp = document.getElementById('grp-name'), name = (inp.value || '').trim().slice(0, 24);
      const players = setup().players.map(p => p.trim()).filter(Boolean);
      if (!name) return toast('Ponle un nombre al grupo.', 'warn');
      if (players.length < 3) return toast('Un grupo necesita al menos 3 nombres.', 'warn');
      Store.groups = Store.groups || [];
      const ex = Store.groups.find(g => R.norm(g.name) === R.norm(name));
      if (ex) ex.players = players; else Store.groups.push({ id: 'g' + uid(), name, players });
      inp.value = ''; render(); toast(ex ? `Grupo «${name}» actualizado.` : `Grupo «${name}» guardado.`);
    },
    resume: () => {
      const g = Store.game;
      if (g.phase === 'reveal') { g.revealStep = 'pass'; g.cardOpen = false; g.cardSeen = false; }
      if (g.timerEnd && g.timerPausedLeft == null) g.timerPausedLeft = Math.max(1, Math.ceil((g.timerEnd - Date.now()) / 1000));
      requestWake(); UI.stack = []; go(g.phase, {}, true);
    },
    'mode-pick': el => { changeMode(el.dataset.id); render(); },
    'pl-add': () => { const s = setup(); if (s.players.length < 30) s.players.push(''); render(); setTimeout(() => { const i = document.getElementById('pl-' + (s.players.length - 1)); if (i) i.focus(); }, 30); },
    'pl-del': el => { const s = setup(); if (s.players.length > 3) { s.players.splice(Number(el.dataset.i), 1); fitImpostors(); } render(); },
    'pl-generic': () => { const s = setup(); s.players = s.players.map((_, i) => `Jugador ${i + 1}`); render(); },
    rule: el => { setRule(el.dataset.k, JSON.parse(el.dataset.v)); render(); },
    'rule-tg': el => { setRule(el.dataset.k, !getRule(el.dataset.k)); render(); },
    step: el => { const k = el.dataset.k; const v = Math.min(Number(el.dataset.max), Math.max(Number(el.dataset.min), getRule(k) + Number(el.dataset.d))); setRule(k, v); render(); },
    preset: el => {
      const s = setup();
      s.rules = R.applyPreset(s.rules, s.mode, el.dataset.id, s.players.length);
      fitImpostors(); render(); toast(`Aplicado: ${R.PRESETS[el.dataset.id].name}`);
    },
    start: () => { if (validation().ok) go('intro'); },
    deal: () => startGame(),
    // categorías
    'cat-toggle': el => { const s = setup(), id = el.dataset.id, i = s.cats.indexOf(id); if (i >= 0) s.cats.splice(i, 1); else s.cats.push(id); render(); },
    'cat-all': () => { setup().cats = catalog().map(c => c.id); render(); },
    'cat-none': () => { setup().cats = []; render(); },
    'cat-family': () => { setup().cats = catalog().filter(c => !c.adult).map(c => c.id); render(); },
    'cat-edit': el => { UI.wordFilter = 'all'; UI.wordSearch = ''; UI.importOpen = false; UI.editWord = null; go('wordEdit', { id: el.dataset.id }); },
    'new-list': () => {
      let name = 'Mi lista', n = 2; while (Store.custom.some(c => c.name === name)) name = 'Mi lista ' + n++;
      const c = { id: 'c-' + uid(), name, desc: '', h: [175, 265, 30, 330, 95][Store.custom.length % 5], words: [] };
      Store.custom.push(c); setup().cats.push(c.id);
      UI.wordFilter = 'all'; UI.wordSearch = ''; UI.importOpen = true; go('wordEdit', { id: c.id });
      setTimeout(() => { const i = document.getElementById('cl-name'); if (i) { i.focus(); i.select(); } }, 50);
    },
    'cl-hue': el => { const c = Store.custom.find(x => x.id === UI.args.id); c.h = Number(el.dataset.h); render(); },
    'cl-del': () => { Store.custom = Store.custom.filter(x => x.id !== UI.args.id); const s = setup(); s.cats = s.cats.filter(id => id !== UI.args.id); back(); toast('Lista borrada.'); },
    'sub-off': el => { const k = el.dataset.id; if (Store.subOff[k]) delete Store.subOff[k]; else Store.subOff[k] = true; render(); },
    'imp-open': () => { UI.importOpen = !UI.importOpen; render(); },
    'imp-do': () => {
      const ta = document.getElementById('imp-ta'); const items = parseBulk(ta.value);
      if (!items.length) return toast('Escribe al menos una palabra.', 'warn');
      let ok = 0, dup = 0; items.forEach(it => { const r = addWord(UI.args.id, it.w, it.sim); if (r === 'ok') ok++; else if (r === 'dup') dup++; });
      UI.importOpen = false; render(); toast(`${plural(ok, 'palabra añadida', 'palabras añadidas')}${dup ? ` · ${plural(dup, 'duplicada omitida', 'duplicadas omitidas')}` : ''}.`);
    },
    'w-add': () => {
      const w = document.getElementById('nw-w'), s = document.getElementById('nw-s');
      const r = addWord(UI.args.id, w.value, s.value);
      if (r === 'empty') return toast('Escribe una palabra.', 'warn');
      if (r === 'dup') return toast(`«${w.value.trim()}» ya está en esta categoría.`, 'warn');
      render(); toast('Palabra añadida.');
      setTimeout(() => { const i = document.getElementById('nw-w'); if (i) i.focus(); }, 30);
    },
    'w-fav': el => { const k = el.dataset.k; setWordState(k, 'fav', !(Store.wordState[k] || {}).fav); render(); },
    'w-off': el => { const k = el.dataset.k; setWordState(k, 'off', !(Store.wordState[k] || {}).off); render(); },
    'w-filter': el => { UI.wordFilter = el.dataset.v; render(); },
    'w-allon': () => { catalog().find(c => c.id === UI.args.id).words.forEach(w => setWordState(w.key, 'off', false)); render(); },
    'w-alloff': () => { catalog().find(c => c.id === UI.args.id).words.forEach(w => setWordState(w.key, 'off', true)); render(); toast('Todas desactivadas. Actívalas cuando quieras.'); },
    'w-edit': el => { UI.editWord = el.dataset.k; render(); setTimeout(() => { const i = document.getElementById('ew-w'); if (i) i.focus(); }, 30); },
    'w-cancel': () => { UI.editWord = null; render(); },
    'w-save': el => {
      const arr = catWordsArr(UI.args.id), item = arr.find(x => x.id === el.dataset.id);
      const nsEl = document.getElementById('ew-s');
      const nw = document.getElementById('ew-w').value.trim().slice(0, 40), ns = nsEl ? nsEl.value.trim().slice(0, 40) : '';
      if (!nw) return toast('La palabra no puede quedar vacía.', 'warn');
      if (item.img || item.data) { item.w = nw; UI.editWord = null; render(); return toast('Guardado.'); }
      const nk = R.keyOf(UI.args.id, nw), ok = R.keyOf(UI.args.id, item.w);
      if (nk !== ok && catalog().find(c => c.id === UI.args.id).words.some(x => x.key === nk)) return toast('Ya existe esa palabra en esta categoría.', 'warn');
      if (nk !== ok && Store.wordState[ok]) { Store.wordState[nk] = Store.wordState[ok]; delete Store.wordState[ok]; }
      item.w = nw; item.sim = ns; UI.editWord = null; render(); toast('Guardado.');
    },
    'w-del': el => {
      const arr = catWordsArr(UI.args.id), i = arr.findIndex(x => x.id === el.dataset.id);
      if (i >= 0) {
        const w = arr[i];
        delete Store.wordState[(w.img || w.data) ? UI.args.id + '::img:' + w.id : R.keyOf(UI.args.id, w.w)];
        if (w.img && Caps.assets) Caps.assets.delete(w.img).catch(() => {});
        arr.splice(i, 1);
      }
      render(); toast('Borrada.');
    },
    // revelación
    'quit-ask': () => { UI.confirm = 'quit'; render(); setTimeout(() => { const q = document.querySelector('.quit'); if (q) q.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 30); },
    quit: () => { Store.game = null; releaseWake(); UI.stack = []; go('home', {}, true); },
    'home-quit-do': () => { Store.game = null; releaseWake(); UI.confirm = null; render(); toast('Partida abandonada. No cuenta en las estadísticas.'); },
    'rv-me': () => { const g = Store.game; g.revealStep = 'card'; g.cardOpen = false; g.cardSeen = false; render(true); },
    'rv-flip': () => { const g = Store.game; g.cardOpen = !g.cardOpen; if (g.cardOpen) { g.cardSeen = true; vibrate(30); } setCard(); },
    'rv-done': () => {
      const g = Store.game; if (!g.cardSeen) return;
      g.cardOpen = false; g.cardSeen = false;
      if (g.revealIdx + 1 < g.players.length) { g.revealIdx++; g.revealStep = 'pass'; render(true); }
      else { g.revealStep = 'pass'; startClueRound(); render(true); }
    },
    // pistas
    'new-q': () => { Store.game.q = pickQ(); render(); },
    'clue-next': () => nextTurn(false),
    'timer-pause': () => {
      const g = Store.game; if (!g.timerEnd && g.timerPausedLeft == null) return;
      if (g.timerPausedLeft != null) { g.timerEnd = Date.now() + g.timerPausedLeft * 1000; g.timerPausedLeft = null; }
      else g.timerPausedLeft = Math.max(1, Math.ceil((g.timerEnd - Date.now()) / 1000));
      render();
    },
    'to-vote': () => startVote(),
    // votación
    'v-sel': el => { Store.game.vote.sel = Number(el.dataset.i); render(); },
    'v-confirm': () => { const s = Store.game.vote.sel; if (s == null) return; resolveVote(s >= 0 ? s : null, { reason: s >= 0 ? 'El grupo ha decidido' : 'El grupo ha decidido no echar a nadie.' }); },
    'sv-open': () => { Store.game.vote.step = 'ballot'; render(true); },
    'sv-cast': el => {
      const g = Store.game, v = g.vote; v.votes.push(Number(el.dataset.i)); v.i++; v.step = 'pass';
      if (v.i < v.voters.length) return render(true);
      const t = R.tally(v.votes, g.rules.tie);
      if (t.revote && !v.revoted) {
        const alive = g.players.map((p, i) => p.alive ? i : -1).filter(i => i >= 0);
        g.vote = { voters: R.shuffle(alive, rng), i: 0, step: 'pass', votes: [], candidates: t.top, revoted: true, prevCounts: t.counts };
        toast('Empate. Toca desempatar.', 'warn'); return render(true);
      }
      resolveVote(t.eliminated, { counts: t.counts, tie: t.tie, reason: t.eliminated != null ? (t.tie ? 'Empate resuelto al azar:' : 'Por mayoría, fuera') : (t.tie ? 'Empate: nadie sale.' : 'Todos han votado en blanco.') });
    },
    'g-check': () => { const g = Store.game, inp = document.getElementById('guess-in'); const ok = R.guessMatches(g, inp.value); if (!inp.value.trim()) return toast('Escribe un intento.', 'warn'); doGuess(ok); },
    'g-manual': el => doGuess(el.dataset.v === '1'),
    'vr-next': () => afterVote(),
    // final
    rematch: () => { Store.game = null; startGame(); },
    'end-setup': () => { Store.game = null; UI.stack = []; go('setup', {}, true); UI.stack = [{ view: 'home', args: {} }]; },
    // estadísticas y ajustes
    'stats-reset': () => { Store.history = []; Store.playerStats = {}; UI.confirm = null; render(); toast('Estadísticas borradas.'); },
    set: el => { Store.settings[el.dataset.k] = el.dataset.v; applyTheme(); render(); },
    'set-tg': el => { const k = el.dataset.k; Store.settings[k] = k === 'sound' ? Store.settings.sound === false : !Store.settings[k]; if (k === 'sound') Sound.play('toggle'); render(); },
    'clear-used': () => { Store.used = []; UI.confirm = null; render(); toast('Todas las palabras vuelven a estar disponibles.'); },
    'reset-words': () => { Store.added = {}; Store.subOff = {}; Object.keys(Store.wordState).forEach(k => { if (!k.startsWith('c-')) delete Store.wordState[k]; }); UI.confirm = null; render(); toast('Categorías incluidas restauradas.'); },
    backup: () => {
      const data = JSON.stringify(Object.assign({}, Store, { game: null }));
      const done = () => toast('Copia de seguridad copiada. Pégala en una nota para guardarla.');
      try { navigator.clipboard.writeText(data).then(done, () => fallbackCopy(data)); } catch (e) { fallbackCopy(data); }
    },
    'restore-open': () => { UI.restoreOpen = !UI.restoreOpen; render(); },
    'restore-do': () => {
      try {
        const d = JSON.parse(document.getElementById('restore-ta').value);
        if (!d || d.v !== 1) throw new Error();
        const keep = Store.game; Object.keys(Store).forEach(k => delete Store[k]); Object.assign(Store, defaultStore(), d, { game: keep });
        UI.restoreOpen = false; applyTheme(); render(); toast('Datos restaurados.');
      } catch (e) { toast('Ese texto no es una copia de seguridad válida.', 'warn'); }
    },
    wipe: () => { Object.keys(Store).forEach(k => delete Store[k]); Object.assign(Store, defaultStore()); UI.confirm = null; applyTheme(); go('home', {}, true); UI.stack = []; toast('Datos borrados.'); }
  };
  function doGuess(ok) {
    const g = Store.game; const idx = g.lastVote.eliminated;
    R.applyGuess(g, idx, ok); g.guessState = ok ? 'right' : 'wrong'; vibrate(ok ? [60, 40, 120] : 40); render();
  }
  function fallbackCopy(text) {
    UI.restoreOpen = true; render();
    const ta = document.getElementById('restore-ta'); if (ta) { ta.value = text; ta.select(); }
    toast('Selecciona el texto y cópialo a mano.', 'warn');
  }
  function setCard() {
    const g = Store.game, c = document.getElementById('card');
    if (c) c.classList.toggle('open', !!g.cardOpen);
    const b = document.querySelector('[data-a="rv-done"]');
    if (b && g.cardSeen) { b.disabled = false; b.classList.add('btn-accent'); }
    save();
  }

/*JAM*/
  /* ---------- eventos ---------- */
  $app.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const fn = A[el.dataset.a];
    if (fn) {
      e.preventDefault();
      const a = el.dataset.a; if (!(a === 'set-tg' && el.dataset.k === 'sound')) Sound.play(SOUND_FOR[a] || 'tap');
      fn(el, e);
    }
  });
  $app.addEventListener('input', e => {
    const el = e.target, k = el.dataset.in;
    if (k === 'pl') { setup().players[Number(el.dataset.i)] = el.value; refreshValid(); save(); }
    else if (k === 'cl-name') { const c = Store.custom.find(x => x.id === UI.args.id); c.name = el.value.slice(0, 30) || 'Sin nombre'; document.querySelector('.hd-title').textContent = c.name; save(); }
    else if (k === 'host-name') { Store.me.name = el.value.slice(0, 20); save(); }
    else if (k === 'cl-desc') { const c = Store.custom.find(x => x.id === UI.args.id); c.desc = el.value.slice(0, 80); save(); }
    else if (k === 'w-search') { UI.wordSearch = el.value; const pos = el.selectionStart; render(); const i = document.getElementById('w-search'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (x) {} } }
  });
  $app.addEventListener('change', e => {
    const el = e.target, k = el.dataset.in;
    if (el.id === 'img-in' && el.files && el.files.length) { addImages([...el.files]); return; }
    if (k === 'rule-num') { setRule(el.dataset.k, Number(el.value)); render(); }
    else if (k === 'rule-str') { setRule(el.dataset.k, el.value); render(); }
  });
  $app.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.det) UI.open[d.dataset.det] = d.open; }, true);
  $app.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const id = e.target.id;
    if (id === 'nw-w' || id === 'nw-s') { e.preventDefault(); A['w-add'](); }
    else if (id === 'guess-in') { e.preventDefault(); A['g-check'](); }
    else if (id === 'clue-in') { e.preventDefault(); A['clue-next'](); }
    else if (id.startsWith('pl-')) { e.preventDefault(); const nx = document.getElementById('pl-' + (Number(id.slice(3)) + 1)); if (nx) nx.focus(); else A['pl-add'](); }
  });
  // mantener pulsado para revelar
  const holdOn = e => { const b = e.target.closest('[data-hold]'); if (!b) return; e.preventDefault(); const g = Store.game; g.cardOpen = true; g.cardSeen = true; vibrate(30); setCard(); };
  const holdOff = () => { const g = Store.game; if (g && g.cardOpen && Store.settings.revealStyle === 'hold' && UI.view === 'reveal') { g.cardOpen = false; setCard(); } };
  $app.addEventListener('pointerdown', holdOn);
  window.addEventListener('pointerup', holdOff); window.addEventListener('pointercancel', holdOff);
  $app.addEventListener('contextmenu', e => { if (e.target.closest('[data-hold]')) e.preventDefault(); });
  // si la app pasa a segundo plano, la tarjeta se cierra
  document.addEventListener('visibilitychange', () => {
    const g = Store.game;
    if (document.hidden && g && g.cardOpen) { g.cardOpen = false; setCard(); }
    if (!document.hidden && g && g.phase !== 'end') requestWake();
  });

  /* ---------- tema ---------- */
  function applyTheme() {
    const t = Store.settings.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  /* ---------- render ---------- */
  function render(top) {
    const g = Store.game;
    // las vistas de partida dependen de la fase
    if (['reveal', 'clues', 'debate', 'vote', 'voteResult', 'end'].includes(UI.view)) {
      if (!g) UI.view = 'home'; else UI.view = g.phase;
    }
    const y = window.scrollY;
    const keep = {}; let focusId = null, selS = null;
    $app.querySelectorAll('[data-keep]').forEach(el => { keep[el.id] = el.value; });
    if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.keep) { focusId = document.activeElement.id; try { selS = document.activeElement.selectionStart; } catch (e) {} }
    const fn = V[UI.view] || V.home;
    $app.innerHTML = `<div class="screen v-${UI.view}${top ? '' : ' still'}">${fn()}</div>`;
    $app.dataset.view = UI.view;
    Object.entries(keep).forEach(([id, v]) => { const el = document.getElementById(id); if (el && v) el.value = v; });
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { if (selS != null) el.setSelectionRange(selS, selS); } catch (e) {} } }
    if (top) window.scrollTo(0, 0); else window.scrollTo(0, y);
    timerLoop();
    afterRender.forEach(f => { try { f(); } catch (e) {} });
    save();
  }

  applyTheme();
  // si había una partida a medias, se ofrece continuar desde inicio
  if (Store.game && Store.game.phase === 'reveal') { Store.game.revealStep = 'pass'; Store.game.cardOpen = false; }
  render(true);
  try { window.claude && window.claude.hot && window.claude.hot.snapshot && window.claude.hot.snapshot(() => ({ view: UI.view })); } catch (e) {}
})();
