  /* =========================================================
     MODO SALA: cada jugador en su móvil
     - Transporte: capacidad `room` (sala con nombre = código).
     - El anfitrión (quien puede editar el artefacto) manda el estado
       público por el tema "st" y cada tarjeta cifrada por el tema "card".
     - Los jugadores solo escriben en su `presence`: nombre, clave pública,
       "listo", pista, voto (cifrado) e intento de adivinar.
     - Cifrado: ECDH P-256 + AES-GCM. Cada tarjeta y cada voto solo los puede
       leer su destinatario.
     ========================================================= */
  const ARTIFACT_URL = 'https://claude.ai/artifact/DiyBH86ezmKyiXWsB1nffh';
  const STANDALONE = typeof window !== 'undefined' && window.IMPOSTOR_STANDALONE === true;
  const Caps = { room: null, user: null, assets: null, canEdit: false, ready: false, standalone: STANDALONE, jamData: STANDALONE };
  const J = { room: null, keys: {}, pres: {}, online: new Set(), timer: null, connecting: false, err: '' }; // anfitrión (vivo)
  const P = { room: null, st: null, stAt: 0, hostKey: null, hostPub: '', connecting: false, err: '', lastSt: '' };   // jugador (vivo)

  /* ---------- capacidades ---------- */
  (async () => {
    await new Promise(r => setTimeout(r, 0)); // dejar que la app termine de arrancar
    if (STANDALONE) {
      Caps.room = (typeof PeerRoom !== 'undefined' && PeerRoom.available()) ? PeerRoom : null;
      Caps.canEdit = true; Caps.ready = true; onCapsReady(); return;
    }
    const use = n => (window.claude && typeof window.claude.use === 'function') ? window.claude.use(n).catch(() => null) : Promise.resolve(null);
    try {
      const [room, user, assets] = await Promise.all([use('room'), use('user'), use('assets')]);
      Caps.room = room; Caps.user = user; Caps.assets = assets;
      if (user) Caps.canEdit = await user.canEdit().catch(() => false);
    } catch (e) {}
    Caps.ready = true;
    onCapsReady();
  })();

  /* ---------- criptografía ---------- */
  const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const EC = { name: 'ECDH', namedCurve: 'P-256' };
  async function newKeyPair() {
    const kp = await subtle.generateKey(EC, true, ['deriveKey']);
    return { jwk: await subtle.exportKey('jwk', kp.privateKey), pub: b64(await subtle.exportKey('raw', kp.publicKey)) };
  }
  const privCache = new Map();
  async function importPriv(jwk) {
    const k = JSON.stringify(jwk);
    if (!privCache.has(k)) privCache.set(k, await subtle.importKey('jwk', jwk, EC, false, ['deriveKey']));
    return privCache.get(k);
  }
  async function sharedKey(jwk, pubB64) {
    const pub = await subtle.importKey('raw', unb64(pubB64), EC, false, []);
    return subtle.deriveKey({ name: 'ECDH', public: pub }, await importPriv(jwk), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function unseal(key, box) {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(td.decode(pt));
  }

  /* ---------- identidad de este móvil ---------- */
  async function ensureMe() {
    if (Store.me && Store.me.jwk && Store.me.pid) return Store.me;
    const kp = await newKeyPair();
    Store.me = Object.assign({ name: '' }, Store.me || {}, { pid: 'p' + uid(), jwk: kp.jwk, pub: kp.pub });
    save(); return Store.me;
  }
  const newCode = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(rng() * a.length)]; return s; };
  const roomName = code => 'imp-' + code;
  const joinUrl = code => (STANDALONE ? location.origin + location.pathname : ARTIFACT_URL) + '#sala-' + code;
  function hashCode() { const m = /^#sala-([a-z0-9]{3,12})$/.exec(location.hash || ''); return m ? m[1] : ''; }
  function jamProblem() {
    if (!Caps.ready) return 'Conectando…';
    if (!subtle) return 'Este navegador no permite el cifrado que usa la sala.';
    if (!Caps.room) return STANDALONE ? 'No se pudo cargar la conexión entre móviles. Comprueba que tienes internet y recarga.' : 'No se puede conectar a la sala desde aquí. Hay que abrir la app desde su enlace de Claude, con la sesión iniciada y con acceso concedido por el anfitrión.';
    return '';
  }

  /* =========================================================
     ANFITRIÓN
     ========================================================= */
  const jam = () => Store.jam;
  const jg = () => Store.jam && Store.jam.game;
  function freshExtra() { return { ready: [], acks: [], votes: {}, voteKey: '', voteN: 0, candidates: [], guessText: '', cards: {} }; }

  async function hostCreate() {
    if (jamProblem()) return toast(jamProblem(), 'warn');
    if (!Caps.canEdit) return toast('Solo quien puede editar la app puede crear una sala.', 'warn');
    const me = await ensureMe();
    if (!me.name) me.name = (Store.players[0] || 'Anfitrión');
    const kp = await newKeyPair();
    Store.jam = { code: newCode(), seq: 0, hostPlays: true, members: {}, order: [], kicked: [], game: null, hk: kp, extra: freshExtra() };
    save();
    await hostConnect();
    for (let k = 0; k < 3 && !J.room && J.taken; k++) { Store.jam.code = newCode(); save(); await hostConnect(); }
    UI.stack = [{ view: 'home', args: {} }]; go('jamHost', {}, true);
  }
  async function hostConnect() {
    if (J.room || J.connecting || !Caps.room || !jam()) return;
    J.connecting = true; J.err = '';
    try {
      J.taken = false;
      J.room = await Caps.room.join(roomName(jam().code), { hub: true });
      J.room.presence({ host: jam().code, hp: jam().hk.pub }).catch(() => {});
      J.room.onPeers(onHostPeers, e => { J.err = e.message || e.code; J.room = null; renderSoon(); });
      clearInterval(J.timer);
      J.timer = setInterval(hostTick, 250);
    } catch (e) {
      J.taken = (e && e.code) === 'id_taken';
      J.err = (e && e.code) === 'not_permitted' ? 'No tienes permiso para abrir salas aquí.' : J.taken ? 'Esa sala sigue abierta en otro sitio. Espera unos segundos y pulsa Reconectar.' : 'No se pudo abrir la sala. Comprueba tu conexión y pulsa Reconectar.';
    }
    J.connecting = false; renderSoon();
  }
  function hostLeave() {
    try { if (J.room) J.room.leave(); } catch (e) {}
    clearInterval(J.timer); J.room = null; J.keys = {}; J.pres = {}; J.online = new Set();
    Store.jam = null; save();
  }
  let lastHostEmit = 0, lastCardSend = 0;
  function hostTick() {
    const now = Date.now();
    jamTimerLoop();
    if (now - lastHostEmit > 2000) emitState();
    if (now - lastCardSend > 3000) sendCards();
  }

  function onHostPeers(ch) {
    const j = jam(); if (!j) return;
    J.online = new Set(); J.pres = {};
    for (const p of ch.peers) {
      const pr = p.presence || {};
      if (p.sameTab || pr.g !== j.code || typeof pr.pid !== 'string' || typeof pr.pk !== 'string') continue;
      if (j.kicked.includes(pr.pid)) continue;
      const name = String(pr.n || '').trim().slice(0, 20) || 'Sin nombre';
      J.online.add(pr.pid); J.pres[pr.pid] = pr;
      const m = j.members[pr.pid];
      if (!m) { j.members[pr.pid] = { n: name, pk: pr.pk }; j.order.push(pr.pid); }
      else { if (!j.game) m.n = name; if (m.pk !== pr.pk) { m.pk = pr.pk; delete J.keys[pr.pid]; } }
    }
    if (ch.joined && ch.joined.length) { emitState(); lastCardSend = 0; if (!j.game && ch.joined.some(p => !p.sameTab)) Sound.play('join'); }
    processSignals();
    renderSoon();
  }
  async function keyFor(pid) {
    const m = jam().members[pid]; if (!m) return null;
    if (!J.keys[pid]) J.keys[pid] = sharedKey(jam().hk.jwk, m.pk);
    return J.keys[pid];
  }
  function lobbyMembers() {
    const j = jam(), list = [];
    if (j.hostPlays) list.push({ pid: Store.me.pid, n: Store.me.name || 'Anfitrión', host: true, on: true });
    j.order.forEach(pid => { if (!j.kicked.includes(pid) && j.members[pid]) list.push({ pid, n: j.members[pid].n, on: J.online.has(pid) }); });
    return list;
  }
  const myIdx = () => { const g = jg(); return g ? g.players.findIndex(p => p.pid === Store.me.pid) : -1; };
  // las claves llevan el id de la partida: así una pista o un voto que siga en la presencia de la partida anterior no cuenta
  const turnKey = g => `${g.id}.${g.round}.${g.clueRound}.${g.turn}`;

  /* ---------- estado público ---------- */
  function timerInfo(g) {
    if (!g.timerEnd && g.timerPausedLeft == null) return null;
    const left = g.timerPausedLeft != null ? g.timerPausedLeft : Math.max(0, Math.ceil((g.timerEnd - Date.now()) / 1000));
    return { l: left, T: g.timerTotal, p: g.timerPausedLeft != null ? 1 : 0 };
  }
  function pubState() {
    const j = jam(), g = j.game, e = j.extra;
    const s = { c: j.code, seq: ++j.seq, hp: j.hk.pub, ph: g ? g.phase : 'lobby', gid: g ? g.id : '' };
    if (!g) { s.pl = lobbyMembers().map(m => ({ p: m.pid, n: m.n, h: m.host ? 1 : 0 })); s.mode = R.modeById(setup().mode).name; return s; }
    const r = g.rules;
    s.mode = R.modeById(g.mode).name;
    s.pl = g.players.map(p => ({ p: p.pid, n: p.name, a: p.alive ? 1 : 0, h: p.pid === Store.me.pid ? 1 : 0 }));
    s.r = { cr: r.clueRounds, mr: r.maxRounds, reg: r.registerClues ? 1 : 0, ts: r.turnStyle, mc: r.maxClues, gs: r.guess, un: r.impostorInfo === 'unaware' ? 1 : 0 };
    s.rd = g.round; s.crd = g.clueRound;
    s.tm = timerInfo(g);
    if (g.phase === 'reveal') s.ready = e.ready;
    if (g.phase === 'clues') {
      s.o = g.order; s.t = g.turn; s.q = g.q;
      if (g.cond) s.cond = { l: g.cond.label, h: g.cond.hint, ty: g.cond.type };
      if (r.maxClues) s.cl = g.players.map(p => p.cluesLeft);
    }
    if (['clues', 'debate'].includes(g.phase)) s.clues = g.clues.filter(c => c.round === g.round).slice(-14).map(c => [c.idx, String(c.text).slice(0, 48), c.flag || '']);
    if (g.phase === 'vote') { s.vk = e.voteKey; s.cand = e.candidates; s.voted = Object.keys(e.votes).map(Number); }
    if (g.phase === 'voteResult') {
      const lv = g.lastVote, el = lv.eliminated;
      const showRole = el != null && (r.revealOnElim || (g.players[el].role === 'impostor' && r.guess !== 'off'));
      s.vk = e.voteKey;
      const sa = g.guessState === 'pending' ? null : R.statusAfterVote(g);
      s.last = { sk: sa ? sa.kind : '', stx: sa ? sa.text : '', e: el, ro: showRole ? (g.players[el].role === 'impostor' ? 1 : 0) : -1, rs: lv.reason || '', cnt: lv.counts || null, gst: g.guessState || '', gt: String(e.guessText || '').slice(0, 40) };
    }
    if (g.phase === 'end') {
      const sc = g.secret;
      s.res = { w: g.result.winner, rs: g.result.reason, word: sc.w, img: sc.img || '', cat: sc.catName, imp: sc.imp || '', impImg: sc.impImg || '', roles: g.players.map(p => p.role === 'impostor' ? 1 : 0), part: g.partial, wr: r.winRule };
      if (Caps.jamData) { s.res.data = sc.data || ''; s.res.impData = sc.impData || ''; }
    }
    return s;
  }
  function emitState() {
    const j = jam(); if (!j || !J.room) return;
    let s = pubState(), txt = JSON.stringify(s);
    const LIM = Caps.jamData ? 200000 : 3800;
    while (txt.length > LIM && s.clues && s.clues.length) { s.clues.shift(); txt = JSON.stringify(s); }
    if (txt.length > LIM) { s.pl.forEach(p => { p.n = p.n.slice(0, 10); }); txt = JSON.stringify(s); }
    lastHostEmit = Date.now();
    J.room.emit('st', s).catch(() => {});
    save();
  }
  async function sendCards() {
    lastCardSend = Date.now();
    const j = jam(), g = j && j.game; if (!g || !J.room) return;
    for (const p of g.players) {
      if (p.pid === Store.me.pid || j.extra.acks.includes(p.pid)) continue;
      const box = j.extra.cards[p.pid]; if (!box) continue;
      J.room.emit('card', { to: p.pid, gid: g.id, iv: box.iv, ct: box.ct }).catch(() => {});
    }
  }

  /* ---------- señales de los jugadores ---------- */
  // si llegan señales mientras se descifra un voto, se apunta y se repasa todo otra vez al terminar
  let processing = false, again = false;
  async function processSignals() {
    if (!jg()) return;
    if (processing) { again = true; return; }
    processing = true;
    try { do { again = false; await processOnce(); } while (again && jg()); } finally { processing = false; }
    emitState(); renderSoon();
  }
  async function processOnce() {
    const j = jam(), g = j && j.game; if (!g) return;
    const e = j.extra;
    const idxOf = pid => g.players.findIndex(p => p.pid === pid);
    for (const [pid, pr] of Object.entries(J.pres)) {
      const i = idxOf(pid); if (i < 0) continue;
      if (pr.ack === g.id && !e.acks.includes(pid)) e.acks.push(pid);
      if (g.phase === 'reveal' && pr.ready === g.id && !e.ready.includes(i)) { e.ready.push(i); if (!e.acks.includes(pid)) e.acks.push(pid); }
      if (g.phase === 'clues' && g.order[g.turn] === i && pr.clue && pr.clue.k === turnKey(g)) { hostClue(String(pr.clue.text || '').slice(0, 60), false); }
      if (g.phase === 'vote' && g.players[i].alive && e.votes[i] == null && pr.vote && pr.vote.k === e.voteKey && pr.vote.b) {
        try {
          const v = await unseal(await keyFor(pid), pr.vote.b);
          if (v.k === e.voteKey && g.phase === 'vote' && e.votes[i] == null) {
            const t = Number(v.t);
            e.votes[i] = (t === -1 || (e.candidates.includes(t) && t !== i)) ? t : -1;
          }
        } catch (x) {}
      }
      if (g.phase === 'voteResult' && g.guessState === 'pending' && g.lastVote.eliminated === i && pr.guess && pr.guess.k === e.voteKey && pr.guess.t) {
        e.guessText = String(pr.guess.t).slice(0, 40); hostGuess(R.guessMatches(g, e.guessText));
      }
    }
    if (g.phase === 'vote' && allVoted()) closeVote();
  }
  function aliveIdx(g) { return g.players.map((p, i) => p.alive ? i : -1).filter(i => i >= 0); }
  function allVoted() { const g = jg(), e = jam().extra; return aliveIdx(g).every(i => e.votes[i] != null); }

  /* ---------- motor de la partida (anfitrión) ---------- */
  async function hostDeal() {
    const j = jam(), s = setup(), mem = lobbyMembers().filter(m => m.on);
    const cfg = Object.assign({}, s, { players: mem.map(m => m.n), jam: !Caps.jamData });
    const info = R.buildPool(catalog(), cfg, Store.used), v = R.validate(cfg, info);
    if (!v.ok) return toast(v.errors[0], 'warn');
    if (info.recycled) { const keys = new Set(info.pool.map(p => p.key)); Store.used = Store.used.filter(k => !keys.has(k)); }
    const g = R.createGame(cfg, info.pool);
    g.players.forEach((p, i) => { p.pid = mem[i].pid; });
    g.phase = 'reveal';
    j.extra = freshExtra();
    for (const p of g.players) {
      if (p.pid === Store.me.pid) continue;
      try {
        const card = Object.assign({}, R.cardFor(g, g.players.indexOf(p)), { gid: g.id, name: p.name }); if (!Caps.jamData) delete card.data;
        j.extra.cards[p.pid] = await seal(await keyFor(p.pid), card);
      } catch (e) { return toast('No se pudo preparar la tarjeta de ' + p.name + '. Que vuelva a entrar.', 'warn'); }
    }
    j.game = g; UI.myCard = false;
    requestWake(); emitState(); sendCards(); render(true);
  }
  function hostStartClues() {
    const g = jg(), r = g.rules;
    g.phase = 'clues'; g.order = R.turnOrder(g); g.turn = 0;
    g.cond = r.turnStyle === 'pistas' && r.clueType !== 'libre' ? R.clueCondition(r) : null;
    g.q = pickQ(); jamStartTimer('clue'); skipEmpty();
  }
  function curHasClues(g) { const p = g.players[g.order[g.turn]]; return !(g.rules.maxClues > 0 && p.cluesLeft <= 0); }
  function skipEmpty() { const g = jg(); if (g.phase === 'clues' && !curHasClues(g)) jamStartTimer(null); }
  function hostClue(text, skipped) {
    const g = jg(), r = g.rules; if (g.phase !== 'clues') return;
    const idx = g.order[g.turn], p = g.players[idx];
    if (curHasClues(g)) {
      if (r.maxClues > 0) p.cluesLeft--;
      if (text) {
        const chk = R.checkClue(g, idx, text);
        let flag = chk.obvious ? 'Dice la palabra' : chk.repeat ? 'Repetida' : '';
        if (flag && r.cluePenalty === 'lose') { if (r.maxClues > 0) p.cluesLeft = Math.max(0, p.cluesLeft - 1); p.penalties++; }
        if (r.cluePenalty === 'none') flag = '';
        g.clues.push({ idx, text, round: g.round, flag });
      } else if (skipped) g.clues.push({ idx, text: '(sin pista: tiempo agotado)', round: g.round, flag: '' });
    }
    g.turn++; g.timerPausedLeft = null;
    if (g.turn >= g.order.length) {
      if (g.clueRound < r.clueRounds) { g.clueRound++; hostStartClues(); }
      else { g.clueRound = 1; g.phase = 'debate'; jamStartTimer('debate'); }
    } else { g.q = pickQ(); jamStartTimer('clue'); skipEmpty(); }
    emitState(); render();
  }
  function hostStartVote() {
    const g = jg(), e = jam().extra;
    g.phase = 'vote'; e.votes = {}; e.voteN = 0; e.voteKey = `${g.id}.${g.round}.0`; e.candidates = aliveIdx(g);
    jamStartTimer('vote'); emitState(); render(true);
  }
  function closeVote(timeout) {
    const g = jg(), e = jam().extra, r = g.rules;
    if (g.phase !== 'vote') return;
    const votes = Object.values(e.votes);
    if (!votes.length && timeout) {
      const pen = r.timeoutPenalty;
      if (pen === 'impostors') { g.forcedWinner = 'impostors'; g.forcedReason = 'timeout'; return hostFinish(R.checkWin(g)); }
      if (pen === 'random') { const al = aliveIdx(g); return hostResolve(al[Math.floor(rng() * al.length)], { reason: 'Tiempo agotado: el azar ha elegido a' }); }
      return hostResolve(null, { reason: 'Se agotó el tiempo y nadie votó.' });
    }
    const t = R.tally(votes, r.tie === 'revote' ? 'revote' : r.tie);
    if (t.revote && e.voteN === 0) {
      e.voteN = 1; e.voteKey = `${g.id}.${g.round}.1`; e.candidates = t.top; e.votes = {};
      jamStartTimer('vote'); toast('Empate: se vota otra vez entre los empatados.', 'warn');
      emitState(); return render(true);
    }
    hostResolve(t.eliminated, { counts: t.counts, tie: t.tie, reason: t.eliminated != null ? (t.tie ? 'Empate resuelto al azar:' : 'Por mayoría, fuera') : (t.tie ? 'Empate: nadie sale.' : 'Todos han votado en blanco.') });
  }
  function hostResolve(elimIdx, extra) {
    const g = jg(), r = g.rules;
    jamStartTimer(null);
    g.lastVote = Object.assign({ eliminated: elimIdx }, extra || {});
    g.guessState = null; jam().extra.guessText = '';
    if (elimIdx != null && R.eliminate(g, elimIdx) && r.guess !== 'off') g.guessState = 'pending';
    g.phase = 'voteResult'; vibrate(60); Sound.play(elimIdx != null ? 'out' : 'tap'); emitState(); render(true);
  }
  function hostGuess(ok) {
    const g = jg(); if (g.phase !== 'voteResult' || !g.guessState || g.guessState === 'right') return;
    if (g.guessState === 'wrong' && !ok) return;
    R.applyGuess(g, g.lastVote.eliminated, ok); g.guessState = ok ? 'right' : 'wrong';
    emitState(); render();
  }
  function hostAfterVote() {
    const g = jg(); const res = R.checkWin(g);
    if (res) return hostFinish(res);
    g.round++; g.clueRound = 1; hostStartClues(); emitState(); render(true);
  }
  function hostFinish(res) {
    const g = jg();
    g.result = Object.assign({ endedAt: Date.now() }, res); g.phase = 'end'; jamStartTimer(null);
    recordStats(g, res); vibrate([80, 60, 160]);
    const mi = myIdx(); Sound.play(mi >= 0 ? ((g.players[mi].role === 'impostor') === (res.winner === 'impostors') ? 'win' : 'lose') : 'win');
    emitState(); render(true);
  }
  function hostNewGame() { const j = jam(); j.game = null; j.extra = freshExtra(); UI.myCard = false; emitState(); render(true); }

  /* temporizador del anfitrión */
  function jamStartTimer(kind) {
    const g = jg(); g.timerPausedLeft = null;
    const secs = kind ? g.rules.timers[kind] : 0;
    if (!secs) { g.timerEnd = null; g.timerKind = null; return; }
    g.timerKind = kind; g.timerTotal = secs; g.timerEnd = Date.now() + secs * 1000;
  }
  function jamTimerLoop() {
    const g = jg(); if (!g || !g.timerEnd || g.timerPausedLeft != null) return paintTimer(g ? timerInfo(g) : null);
    const left = Math.max(0, Math.ceil((g.timerEnd - Date.now()) / 1000));
    paintTimer(timerInfo(g));
    if (left <= 5 && left > 0 && jamTimerLoop.last !== left) Sound.play('tick');
    jamTimerLoop.last = left;
    if (left <= 0) {
      const k = g.timerKind; g.timerEnd = null; g.timerKind = null; vibrate([200, 80, 200]); Sound.play('alarm');
      if (k === 'clue') hostClue('', true);
      else if (k === 'debate') hostStartVote();
      else if (k === 'vote') closeVote(true);
    }
  }
  function paintTimer(t) {
    const el = document.getElementById('jtimer'); if (!el || !t) return;
    const v = document.getElementById('jtimer-v'), fg = document.getElementById('jtr-fg');
    if (v) v.textContent = fmtTime(t.l);
    if (fg) fg.style.strokeDashoffset = String(100 - (t.l / t.T) * 100);
    el.classList.toggle('low', t.l <= 5);
  }
  function jTimerHtml(t, pausable) {
    if (!t) return '';
    return `<div class="timer" id="jtimer"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="tr-bg"/><circle cx="60" cy="60" r="52" class="tr-fg" id="jtr-fg" pathLength="100"/></svg>
      <div class="timer-v" id="jtimer-v">${fmtTime(t.l)}</div>${pausable ? `<button class="icon-btn sm timer-p" data-a="jh-pause" aria-label="${t.p ? 'Reanudar' : 'Pausar'}">${t.p ? icon.play : icon.pause}</button>` : ''}</div>`;
  }

  /* =========================================================
     JUGADOR
     ========================================================= */
  async function playerConnect(code) {
    if (P.room || P.connecting) return;
    P.connecting = true; P.err = '';
    try {
      const me = await ensureMe();
      Store.join = { code }; save();
      P.room = await Caps.room.join(roomName(code));
      P.room.on('st', m => onPlayerState(m));
      P.room.on('card', m => onPlayerCard(m));
      await P.room.presence({ g: code, pid: me.pid, n: me.name, pk: me.pub });
      P.room.onPeers(() => {}, e => { P.err = 'Se perdió la conexión con la sala.'; P.room = null; renderSoon(); });
    } catch (e) { P.room = null; P.err = 'No se pudo entrar en la sala. Comprueba el código y que tienes acceso al enlace.'; }
    P.connecting = false; renderSoon();
  }
  function playerLeave() {
    try { if (P.room) P.room.leave(); } catch (e) {}
    P.room = null; P.st = null; P.lastSt = ''; Store.join = null; Store.myCard = null; save();
    try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  function onPlayerState(m) {
    const s = m.data;
    if (!s || typeof s !== 'object' || !Store.join || s.c !== Store.join.code) return;
    if (P.st && P.st.gid === s.gid && s.seq < P.st.seq && Date.now() - P.stAt < 8000) return;
    if (!P.st || P.st.gid !== s.gid) { UI.cardSeen = false; UI.cardOpen = false; UI.myCard = false; }
    P.st = s; P.stAt = Date.now();
    if (s.hp && s.hp !== P.hostPub) { P.hostPub = s.hp; P.hostKey = null; }
    const key = JSON.stringify(Object.assign({}, s, { seq: 0, tm: s.tm ? { p: s.tm.p, T: s.tm.T } : null }));
    if (Store.myCard && Store.myCard.gid !== s.gid) { Store.myCard = null; UI.myCard = false; }
    if (key !== P.lastSt) { playerCues(P.prev, s); P.prev = s; P.lastSt = key; if (UI.view === 'jamPlayer') render(); }
  }
  function playerCues(a, b) {
    const me = (b.pl || []).findIndex(p => p.p === Store.me.pid);
    if (!a || me < 0) return;
    if (b.ph === 'clues' && b.o && b.o[b.t] === me && !(a.ph === 'clues' && a.o && a.o[a.t] === me && a.t === b.t && a.rd === b.rd && a.crd === b.crd)) { Sound.play('turn'); vibrate([60, 40, 60]); }
    else if (b.ph === 'vote' && a.ph !== 'vote') Sound.play('turn');
    else if (b.ph === 'voteResult' && a.ph !== 'voteResult') Sound.play(b.last && b.last.e != null ? 'out' : 'tap');
    else if (b.ph === 'end' && a.ph !== 'end' && b.res) { const won = (b.res.w === 'impostors') === (b.res.roles && b.res.roles[me] === 1); Sound.play(won ? 'win' : 'lose'); }
    else if (b.ph === 'lobby' && a.ph === 'lobby' && (b.pl || []).length > (a.pl || []).length) Sound.play('join');
  }
  async function hostKeyP() {
    if (!P.hostPub) return null;
    if (!P.hostKey) P.hostKey = sharedKey(Store.me.jwk, P.hostPub);
    return P.hostKey;
  }
  async function onPlayerCard(m) {
    const d = m.data; if (!d || d.to !== Store.me.pid || !P.hostPub) return;
    if (Store.myCard && Store.myCard.gid === d.gid) { P.room.presence({ ack: d.gid }).catch(() => {}); return; }
    try {
      const card = await unseal(await hostKeyP(), d);
      if (card.gid !== d.gid) return;
      Store.myCard = card; save();
      P.room.presence({ ack: d.gid }).catch(() => {});
      vibrate(30); if (UI.view === 'jamPlayer') render();
    } catch (e) { P.hostKey = null; }
  }
  const myPlayerIdx = () => P.st && P.st.pl ? P.st.pl.findIndex(p => p.p === Store.me.pid) : -1;
  function playerTimerLeft() {
    const t = P.st && P.st.tm; if (!t) return null;
    const l = t.p ? t.l : Math.max(0, Math.round(t.l - (Date.now() - P.stAt) / 1000));
    return { l, T: t.T, p: t.p };
  }

  /* =========================================================
     PANTALLAS DE SALA
     ========================================================= */
  function cardBlock(card, name, sub, open) {
    return `<div class="card${open ? ' open' : ''}${card.kind === 'impostor' ? ' is-imp' : ''}" id="card">
      <button class="card-in" data-a="my-flip" aria-label="${open ? 'Cerrar la tarjeta' : 'Ver tu papel'}">
        <span class="face front"><span class="cf-k">${esc(sub)}</span><span class="cf-name">${esc(name)}</span><span class="seal">Confidencial</span><span class="cf-hint">Toca para abrir</span></span>
        <span class="face backf">${cardBack(card)}</span>
      </button></div>`;
  }
  const mono = t => `<div class="jam-k">${t}</div>`;
  function jamBar(code, extra) { return `<div class="jam-bar"><span>Sala <b>${esc(code).toUpperCase()}</b></span>${extra || ''}</div>`; }
  function winTitle(w, un, many) { return w === 'crew' ? 'Los jugadores' : un ? 'Los infiltrados' : many ? 'Los impostores' : 'El impostor'; }
  const REASONS = { caught: 'Habéis descubierto a todos los impostores.', survived: 'Se acabaron las votaciones y algún impostor sigue dentro.', guess: 'El impostor descubierto ha adivinado la palabra.', timeout: 'Se agotó el tiempo de votación.' };
  const reasonText = (rs, wr) => rs === 'numbers' ? (wr === 'superiority' ? 'Los impostores superan en número a los demás.' : 'Los impostores han igualado en número a los demás.') : (REASONS[rs] || '');

  /* ---------- pantalla del anfitrión ---------- */
  V.jamHost = () => {
    const j = jam();
    if (!j) return V.home();
    const g = j.game, conn = J.room ? '<span class="dot-on">En línea</span>' : `<button class="link" data-a="jh-reconnect">${J.connecting ? 'Conectando…' : 'Reconectar'}</button>`;
    const head = header(g ? 'Mesa' : 'Sala', { backAct: 'jh-exit-ask', right: `<span class="hd-meta">${esc(j.code).toUpperCase()}</span>` });
    const exitBox = UI.confirm === 'jh-exit' ? `<div class="quit"><p>¿Cerrar la sala? Los jugadores se quedarán sin partida.</p><div class="row-btns"><button class="btn danger" data-a="jh-close">Cerrar sala</button><button class="btn ghost" data-a="unarm">Seguir</button></div></div>` : '';
    const mi = myIdx(), meIn = g && mi >= 0;
    const myCardBtn = meIn && g.phase !== 'end' ? `<button class="btn ghost sm" data-a="my-card">${UI.myCard ? 'Ocultar mi papel' : 'Ver mi papel'}</button>` : '';
    const myCard = meIn && UI.myCard && g.phase !== 'end' ? cardBlock(R.cardFor(g, mi), g.players[mi].name, 'Tu papel', UI.cardOpen) : '';
    if (!g) {
      const jf = !Caps.jamData, mem = lobbyMembers(), on = mem.filter(m => m.on), s = setup(), v = R.validate(Object.assign({}, s, { players: on.map(m => m.n), jam: jf }), R.buildPool(catalog(), Object.assign({}, s, { jam: jf }), Store.used));
      return head + `<main class="pad jam">
        ${jamBar(j.code, conn)}
        ${J.err ? `<p class="note warn">${esc(J.err)}</p>` : ''}
        <section class="qr-box"><div id="qr" class="qr" aria-label="Código QR de la sala"></div>
          <div class="qr-tx"><div class="jam-k">Escanea o abre el enlace</div><div class="code-big">${esc(j.code).toUpperCase()}</div>
          <div class="link-row"><input class="inp" id="join-link" readonly value="${esc(joinUrl(j.code))}" aria-label="Enlace de la sala"><button class="btn sm" data-a="copy-link">Copiar</button></div></div></section>
        <p class="note small">${STANDALONE ? 'Cualquiera puede entrar con el QR o el enlace, sin cuenta. Deja esta pantalla abierta: tu móvil hace de servidor de la partida.' : 'Cada jugador necesita abrir el enlace con su cuenta de Claude y tener acceso a esta app (compártela con ellos desde el menú Compartir).'}</p>
        <section class="sec"><div class="sec-h"><h2>Jugadores <span class="count">${on.length}</span></h2></div>
          <ul class="mem">${mem.map(m => `<li class="${m.on ? '' : 'off'}"><span class="mem-dot"></span><span class="mem-n">${esc(m.n)}${m.host ? ' <small>(tú)</small>' : ''}</span>${m.host ? '' : `<button class="icon-btn sm" data-a="jh-kick" data-id="${esc(m.pid)}" aria-label="Echar a ${esc(m.n)}">${icon.close}</button>`}</li>`).join('') || '<li class="muted">Esperando a que entre gente…</li>'}</ul>
          ${row('Yo también juego', 'Tu papel lo verás en este móvil.', sw(j.hostPlays, 'jh-plays'))}
          ${j.hostPlays ? `<label class="lbl" for="host-name">Tu nombre</label><input class="inp" id="host-name" data-in="host-name" maxlength="20" value="${esc(Store.me.name || '')}">` : ''}
        </section>
        <section class="sec"><div class="sec-h"><h2>Partida</h2><button class="link" data-a="nav" data-to="setup">Reglas y categorías</button></div>
          <p class="muted">${esc(R.modeById(s.mode).name)} · ${impLabel(s, on.length)} · ${plural(s.cats.length, 'categoría')}</p>
          ${v.ok ? '' : `<p class="note warn">${esc(v.errors[0])}</p>`}${v.warnings.length ? `<p class="note small">${esc(v.warnings[0])}</p>` : ''}
        </section>${exitBox}
      </main>
      <footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="jh-deal" ${v.ok && J.room ? '' : 'disabled'}>Repartir papeles</button></div></footer>`;
    }
    const e = j.extra, r = g.rules, names = i => esc(g.players[i].name);
    let body = '', foot = '';
    if (g.phase === 'reveal') {
      const remote = g.players.map((p, i) => i).filter(i => g.players[i].pid !== Store.me.pid);
      const waiting = remote.filter(i => !e.ready.includes(i));
      body = `<h2 class="big-h">Mirad vuestro papel</h2><p class="muted">Cada uno lo ve en su móvil. Cuando todos lo hayan visto, empezad.</p>
        <ul class="mem">${remote.map(i => `<li class="${e.ready.includes(i) ? 'ok' : ''}"><span class="mem-dot"></span><span class="mem-n">${names(i)}</span><span class="pill">${e.ready.includes(i) ? 'Listo' : J.online.has(g.players[i].pid) ? (e.acks.includes(g.players[i].pid) ? 'Mirando' : 'Enviando…') : 'Desconectado'}</span></li>`).join('')}</ul>`;
      foot = `<button class="btn ${waiting.length ? '' : 'btn-accent'} big" data-a="jh-clues">${waiting.length ? `Empezar igualmente (faltan ${waiting.length})` : 'Empezar las pistas'}</button>`;
    } else if (g.phase === 'clues') {
      const idx = g.order[g.turn], ask = r.turnStyle === 'preguntas', tgt = ask ? R.questionTarget(g, g.order, g.turn) : null, has = curHasClues(g);
      body = `<div class="clue-meta"><span>Ronda ${g.clueRound} de ${r.clueRounds}</span><span>Turno ${g.turn + 1} de ${g.order.length}</span></div>
        ${g.cond ? `<div class="cond"><span class="cond-k">Condición</span><b>${esc(g.cond.label)}</b><span>${esc(g.cond.hint)}</span>${g.cond.type === 'pregunta' ? `<span class="cond-q">${esc(g.q)}</span>` : ''}</div>` : ''}
        <div class="turn">${ask ? `<div class="turn-l">Pregunta</div><div class="turn-name">${names(idx)}</div><div class="turn-l">a</div><div class="turn-name t2">${names(tgt)}</div><div class="sugg"><span class="cond-k">Idea de pregunta</span><span>${esc(g.q)}</span></div>` : `<div class="turn-l">Turno de</div><div class="turn-name">${names(idx)}</div>`}
        ${!has ? '<div class="pill wrn-p">Sin pistas restantes</div>' : ''}</div>
        ${jTimerHtml(timerInfo(g), true)}
        ${idx === mi && r.registerClues && has ? `<div class="regc"><label class="lbl" for="h-clue">Tu pista</label><input class="inp" id="h-clue" data-keep="1" maxlength="60" autocomplete="off" placeholder="Opcional"></div>` : ''}
        <ol class="order">${g.order.map((x, k) => `<li class="${k < g.turn ? 'done' : k === g.turn ? 'cur' : ''}">${names(x)}</li>`).join('')}</ol>
        <p class="muted small center">${idx === mi ? 'Te toca a ti.' : 'Avanza solo cuando el jugador pulse «He terminado» en su móvil.'}</p>`;
      foot = `<button class="btn ${idx === mi ? 'btn-accent' : ''} big" data-a="jh-next">${idx === mi ? 'He terminado' : 'Saltar turno'}</button>`;
    } else if (g.phase === 'debate') {
      const cl = g.clues.filter(c => c.round === g.round);
      body = `<h2 class="big-h">Debate</h2><p class="muted">Buscad contradicciones. Cuando queráis, abrid la votación: cada uno vota en su móvil.</p>
        ${jTimerHtml(timerInfo(g), true)}
        ${cl.length ? `<ul class="cluelog">${cl.map(c => `<li><b>${names(c.idx)}</b><span>${esc(c.text)}</span>${c.flag ? `<span class="pill wrn-p">${esc(c.flag)}</span>` : ''}</li>`).join('')}</ul>` : ''}`;
      foot = `<button class="btn btn-accent big" data-a="jh-vote">Abrir votación</button>`;
    } else if (g.phase === 'vote') {
      const al = aliveIdx(g), done = al.filter(i => e.votes[i] != null);
      const meVote = mi >= 0 && g.players[mi].alive && e.votes[mi] == null;
      body = `<h2 class="big-h">Votación${e.voteN ? ' de desempate' : ''}</h2><p class="muted">${done.length} de ${al.length} han votado. Los votos van cifrados: nadie ve a quién vota cada uno.</p>
        ${jTimerHtml(timerInfo(g), true)}
        <ul class="mem">${al.map(i => `<li class="${e.votes[i] != null ? 'ok' : ''}"><span class="mem-dot"></span><span class="mem-n">${names(i)}</span><span class="pill">${e.votes[i] != null ? 'Ha votado' : 'Pensando'}</span></li>`).join('')}</ul>
        ${meVote ? `<section class="sec"><div class="sec-h"><h2>Tu voto</h2></div><div class="vgrid">${e.candidates.filter(i => i !== mi).map(i => `<button class="vbtn" data-a="jh-myvote" data-i="${i}">${names(i)}</button>`).join('')}</div><button class="btn ghost" data-a="jh-myvote" data-i="-1">Votar en blanco</button></section>` : ''}`;
      foot = `<button class="btn big" data-a="jh-close-vote" ${done.length ? '' : 'disabled'}>Cerrar votación ya</button>`;
    } else if (g.phase === 'voteResult') {
      const lv = g.lastVote, el = lv.eliminated, p = el != null ? g.players[el] : null, imp = p && p.role === 'impostor';
      const showRole = p && (r.revealOnElim || (imp && r.guess !== 'off'));
      body = `<div class="pass">${p ? `<div class="pass-l">${esc(lv.reason || '')}</div><div class="pass-name">${esc(p.name)}</div><p class="muted">queda fuera de la partida</p>
        ${showRole ? `<div class="verdict ${imp ? 'imp' : 'crew'}">${imp ? (r.impostorInfo === 'unaware' ? 'Era el infiltrado' : 'Era impostor') : 'Era inocente'}</div>` : '<p class="note">Su papel se verá al final.</p>'}` : `<h2 class="big-h">Nadie sale</h2><p class="muted">${esc(lv.reason || '')}</p>`}
        ${lv.counts && Object.keys(lv.counts).length ? `<ul class="tally">${Object.entries(lv.counts).sort((a, b) => b[1] - a[1]).map(([i, c]) => `<li><span>${names(i)}</span><b>${c}</b></li>`).join('')}</ul>` : ''}</div>
        ${g.guessState === 'pending' ? `<section class="sec guess"><div class="sec-h"><h2>Última oportunidad</h2></div>
          ${el === mi ? `<p>Escribe la palabra secreta.</p><div class="addw"><input class="inp" id="h-guess" data-keep="1" autocomplete="off" placeholder="Tu intento"><button class="btn btn-accent" data-a="jh-myguess">Comprobar</button></div>` : `<p>${esc(p.name)} está escribiendo su intento en su móvil…</p>`}
          <div class="row-btns"><button class="btn ghost sm" data-a="jh-guess" data-v="1">Lo dijo en voz alta y acertó</button><button class="btn ghost sm" data-a="jh-guess" data-v="0">Ha fallado</button></div></section>` : ''}
        ${g.guessState === 'right' ? `<div class="verdict imp">¡Ha adivinado la palabra!</div>` : ''}
        ${g.guessState === 'wrong' ? `<p class="note">Ha fallado${e.guessText ? `: dijo «${esc(e.guessText)}»` : ''}. <button class="link" data-a="jh-guess" data-v="1">Dar por buena</button></p>` : ''}
        ${statusLine(g)}`;
      foot = `<button class="btn btn-accent big" data-a="jh-after" ${g.guessState === 'pending' ? 'disabled' : ''}>Continuar</button>`;
    } else if (g.phase === 'end') {
      body = endBody(g);
      foot = `<button class="btn btn-accent big" data-a="jh-new">Otra partida con la misma sala</button>`;
    }
    return head + `<main class="pad jam">${jamBar(j.code, conn + myCardBtn)}${myCard}${body}${exitBox}</main><footer class="bar"><div class="bar-in">${foot}</div></footer>`;
  };
  function endBody(g) {
    const res = g.result, r = g.rules;
    return `<div class="win ${res.winner === 'crew' ? 'crew' : 'imp'}"><div class="win-k">Ganan</div><div class="win-t">${winTitle(res.winner, r.impostorInfo === 'unaware', r.impostors > 1)}</div><p>${esc(reasonText(res.reason, r.winRule))}</p></div>
      ${g.partial.length ? `<p class="note">Victoria parcial para ${g.partial.map(i => esc(g.players[i].name)).join(', ')}.</p>` : ''}
      ${secretBlock(g.secret.w, picSrc(g.secret.img, g.secret.data), g.secret.catName, g.secret.imp, picSrc(g.secret.impImg, g.secret.impData))}
      <ul class="roles">${g.players.map(p => `<li class="${p.role}"><span class="rl-n">${esc(p.name)}</span><span class="rl-r">${p.role === 'impostor' ? (r.impostorInfo === 'unaware' ? 'Infiltrado' : 'Impostor') : 'Jugador'}</span><span class="rl-s">${p.alive ? 'Sigue' : 'Fuera'}</span></li>`).join('')}</ul>`;
  }

  /* ---------- pantalla del jugador ---------- */
  V.jamJoin = () => {
    const code = UI.args.code || hashCode() || '';
    const prob = jamProblem();
    return header('Entrar en una sala') + `<main class="pad">
      <h2 class="big-h">Únete a la partida</h2>
      ${prob && Caps.ready ? `<p class="note warn">${esc(prob)}</p>` : ''}
      <label class="lbl" for="jn-code">Código de la sala</label><input class="inp code-in" id="jn-code" data-keep="1" value="${esc(code.toUpperCase())}" maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="ABCDE">
      <label class="lbl" for="jn-name">Tu nombre</label><input class="inp" id="jn-name" data-keep="1" value="${esc((Store.me && Store.me.name) || '')}" maxlength="20" autocomplete="off" placeholder="Cómo te llaman">
      ${P.err ? `<p class="note warn">${esc(P.err)}</p>` : ''}
    </main><footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="jn-go" ${prob ? 'disabled' : ''}>${P.connecting ? 'Entrando…' : 'Entrar'}</button></div></footer>`;
  };

  V.jamPlayer = () => {
    const s = P.st, code = Store.join ? Store.join.code : '';
    const head = header('Sala ' + code.toUpperCase(), { backAct: 'jp-leave-ask', right: `<span class="hd-meta">${esc((Store.me && Store.me.name) || '')}</span>` });
    const leave = UI.confirm === 'jp-leave' ? `<div class="quit"><p>¿Salir de la sala?</p><div class="row-btns"><button class="btn danger" data-a="jp-leave">Salir</button><button class="btn ghost" data-a="unarm">Quedarme</button></div></div>` : '';
    if (!P.room) return head + `<main class="pad pass"><h2 class="big-h">${P.connecting ? 'Entrando…' : 'Sin conexión'}</h2>${P.err ? `<p class="note warn">${esc(P.err)}</p>` : ''}
      <button class="btn btn-accent" data-a="jp-retry">Volver a intentarlo</button>${leave}</main>`;
    if (!s) return head + `<main class="pad pass"><div class="pass-k">Conectado</div><h2 class="big-h">Esperando al anfitrión…</h2><p class="muted">Si tarda, pide que abra la sala en su móvil.</p>${leave}</main>`;
    const me = myPlayerIdx(), pl = s.pl || [], name = i => esc(pl[i] ? pl[i].n : '?');
    const card = Store.myCard && Store.myCard.gid === s.gid ? Store.myCard : null;
    const myBtn = card && s.ph !== 'end' && s.ph !== 'reveal' ? `<button class="btn ghost sm" data-a="my-card">${UI.myCard ? 'Ocultar mi papel' : 'Ver mi papel'}</button>` : '';
    const myCard = card && UI.myCard && s.ph !== 'reveal' && s.ph !== 'end' ? cardBlock(card, card.name, 'Tu papel', UI.cardOpen) : '';
    const tm = playerTimerLeft();
    let body = '';
    if (s.ph === 'lobby') {
      body = `<div class="pass"><div class="pass-k">Estás dentro</div><h2 class="big-h">Esperando a que empiece</h2><p class="muted">Modo ${esc(s.mode || '')}</p></div>
        <ul class="mem">${pl.map(p => `<li><span class="mem-dot"></span><span class="mem-n">${esc(p.n)}${p.p === Store.me.pid ? ' <small>(tú)</small>' : ''}${p.h ? ' <small>(anfitrión)</small>' : ''}</span></li>`).join('')}</ul>
        ${pl.some(p => p.p === Store.me.pid) ? '' : '<p class="note">Aún no apareces en la lista. Espera unos segundos.</p>'}`;
    } else if (me < 0) {
      body = `<div class="pass"><h2 class="big-h">Partida en curso</h2><p class="muted">Ya había empezado cuando entraste. Jugarás en la siguiente.</p></div>`;
    } else if (s.ph === 'reveal') {
      const ready = (s.ready || []).includes(me);
      body = card ? `${cardBlock(card, card.name, 'Expediente confidencial', UI.cardOpen)}<p class="muted center small">Toca la tarjeta para abrirla y ciérrala antes de enseñar el móvil.</p>`
        : `<div class="pass"><h2 class="big-h">Recibiendo tu papel…</h2><p class="muted">Llega cifrado: solo este móvil puede leerlo.</p></div>`;
      body += ready ? `<p class="note center">Listo. Esperando a los demás…</p>` : '';
      return head + `<main class="pad jam">${body}${leave}</main><footer class="bar"><div class="bar-in"><button class="btn ${UI.cardSeen && !ready ? 'btn-accent' : ''} big" data-a="jp-ready" ${card && UI.cardSeen && !ready ? '' : 'disabled'}>${ready ? 'Esperando a los demás' : 'Ya lo he visto'}</button></div></footer>`;
    } else if (s.ph === 'clues') {
      const idx = s.o[s.t], mine = idx === me, ask = s.r.ts === 'preguntas', tgt = ask ? s.o[(s.t + 1) % s.o.length] : null;
      const noCl = s.r.mc && s.cl && s.cl[idx] <= 0;
      body = `<div class="clue-meta"><span>Ronda ${s.crd} de ${s.r.cr}</span><span>Turno ${s.t + 1} de ${s.o.length}</span></div>
        ${s.cond ? `<div class="cond"><span class="cond-k">Condición</span><b>${esc(s.cond.l)}</b><span>${esc(s.cond.h)}</span>${s.cond.ty === 'pregunta' ? `<span class="cond-q">${esc(s.q)}</span>` : ''}</div>` : ''}
        <div class="turn ${mine ? 'mine' : ''}">${mine ? `<div class="turn-l">${ask ? 'Pregunta a' : 'Es tu turno'}</div><div class="turn-name">${ask ? name(tgt) : 'Te toca'}</div>` : ask ? `<div class="turn-l">Pregunta</div><div class="turn-name">${name(idx)}</div><div class="turn-l">a</div><div class="turn-name t2">${tgt === me ? 'Ti' : name(tgt)}</div>` : `<div class="turn-l">Turno de</div><div class="turn-name">${name(idx)}</div>`}
        ${mine && ask ? `<div class="sugg"><span class="cond-k">Idea de pregunta</span><span>${esc(s.q)}</span></div>` : ''}
        ${s.r.mc && s.cl ? `<div class="pill ${noCl ? 'wrn-p' : ''}">${noCl ? 'Sin pistas restantes' : `Quedan ${s.cl[idx]} pistas`}</div>` : ''}</div>
        ${jTimerHtml(tm, false)}
        ${mine && s.r.reg && !noCl ? `<div class="regc"><label class="lbl" for="p-clue">${ask ? 'Anota la pregunta' : 'Anota tu pista'}</label><input class="inp" id="p-clue" data-keep="1" maxlength="60" autocomplete="off" placeholder="Opcional"></div>` : ''}
        <ol class="order">${s.o.map((x, k) => `<li class="${k < s.t ? 'done' : k === s.t ? 'cur' : ''}">${name(x)}</li>`).join('')}</ol>`;
      return head + `<main class="pad jam">${jamBar(code, myBtn)}${myCard}${body}${leave}</main>${mine ? `<footer class="bar"><div class="bar-in"><button class="btn btn-accent big" data-a="jp-clue">${UI.sentClue === `${s.gid}${s.rd}.${s.crd}.${s.t}` ? 'Enviado…' : 'He terminado'}</button></div></footer>` : ''}`;
    } else if (s.ph === 'debate') {
      body = `<h2 class="big-h">Debate</h2><p class="muted">Hablad y buscad al impostor. El anfitrión abrirá la votación.</p>${jTimerHtml(tm, false)}
        ${(s.clues || []).length ? `<ul class="cluelog">${s.clues.map(c => `<li><b>${name(c[0])}</b><span>${esc(c[1])}</span>${c[2] ? `<span class="pill wrn-p">${esc(c[2])}</span>` : ''}</li>`).join('')}</ul>` : ''}`;
    } else if (s.ph === 'vote') {
      const alive = pl[me] && pl[me].a, voted = (s.voted || []).includes(me) || UI.sentVote === s.gid + s.vk;
      if (!alive) body = `<div class="pass"><h2 class="big-h">Estás fuera</h2><p class="muted">Los que siguen están votando.</p></div>`;
      else if (voted) body = `<div class="pass"><div class="pass-k">Voto enviado</div><h2 class="big-h">Esperando al resto</h2><p class="muted">${(s.voted || []).length} de ${pl.filter(p => p.a).length} han votado.</p></div>`;
      else body = `<h2 class="big-h">¿Quién es el impostor?</h2><p class="muted">Tu voto va cifrado: solo lo cuenta el anfitrión.</p>${jTimerHtml(tm, false)}
        <div class="vgrid">${(s.cand || []).filter(i => i !== me).map(i => `<button class="vbtn" data-a="jp-vote" data-i="${i}">${name(i)}</button>`).join('')}</div>
        <button class="btn ghost" data-a="jp-vote" data-i="-1">Votar en blanco</button>`;
    } else if (s.ph === 'voteResult') {
      const L = s.last || {}, el = L.e;
      body = `<div class="pass">${el != null ? `<div class="pass-l">${esc(L.rs)}</div><div class="pass-name">${el === me ? 'Tú' : name(el)}</div><p class="muted">${el === me ? 'quedas fuera de la partida' : 'queda fuera de la partida'}</p>
        ${L.ro === 1 ? `<div class="verdict imp">${s.r.un ? 'Era el infiltrado' : 'Era impostor'}</div>` : L.ro === 0 ? '<div class="verdict crew">Era inocente</div>' : ''}` : `<h2 class="big-h">Nadie sale</h2><p class="muted">${esc(L.rs)}</p>`}</div>
        ${L.gst === 'pending' && el === me && UI.sentGuess !== s.gid + s.vk ? `<section class="sec guess"><div class="sec-h"><h2>Última oportunidad</h2></div><p>Escribe la palabra secreta. Si aciertas${s.r.gs === 'win' ? ', ganas' : ', logras una victoria parcial'}.</p>
          <div class="addw"><input class="inp" id="p-guess" data-keep="1" autocomplete="off" placeholder="Tu intento"><button class="btn btn-accent" data-a="jp-guess">Enviar</button></div></section>` : ''}
        ${L.gst === 'pending' && (el !== me || UI.sentGuess === s.gid + s.vk) ? '<p class="note center">Última oportunidad del impostor…</p>' : ''}
        ${L.gst === 'right' ? '<div class="verdict imp center">¡Ha adivinado la palabra!</div>' : ''}${L.gst === 'wrong' ? `<p class="note center">No acertó${L.gt ? `: dijo «${esc(L.gt)}»` : ''}.</p>` : ''}
        ${L.stx ? `<div class="status ${esc(L.sk)}">${esc(L.stx)}</div>` : ''}`;
    } else if (s.ph === 'end') {
      const R2 = s.res || {}, iWasImp = R2.roles && R2.roles[me] === 1, won = (R2.w === 'impostors') === iWasImp;
      body = `<div class="win ${R2.w === 'crew' ? 'crew' : 'imp'}"><div class="win-k">${won ? 'Has ganado' : 'Has perdido'} · Ganan</div><div class="win-t">${winTitle(R2.w, s.r.un, R2.roles && R2.roles.filter(Boolean).length > 1)}</div><p>${esc(reasonText(R2.rs, R2.wr))}</p></div>
        ${secretBlock(R2.word, picSrc(R2.img, R2.data || ''), R2.cat, R2.imp, picSrc(R2.impImg, R2.impData || ''))}
        <ul class="roles">${pl.map((p, i) => `<li class="${R2.roles && R2.roles[i] ? 'impostor' : 'crew'}"><span class="rl-n">${esc(p.n)}${i === me ? ' <small>(tú)</small>' : ''}</span><span class="rl-r">${R2.roles && R2.roles[i] ? (s.r.un ? 'Infiltrado' : 'Impostor') : 'Jugador'}</span><span class="rl-s">${p.a ? 'Sigue' : 'Fuera'}</span></li>`).join('')}</ul>
        <p class="muted center">Esperando a que el anfitrión empiece otra partida…</p>`;
    }
    return head + `<main class="pad jam">${s.ph !== 'lobby' ? jamBar(code, myBtn) : ''}${myCard}${body}${leave}</main>`;
  };

  /* ---------- QR ---------- */
  function drawQr() {
    const el = document.getElementById('qr'), j = jam();
    if (!el || !j) return;
    if (el.dataset.code === j.code) return;
    el.dataset.code = j.code; el.innerHTML = '';
    if (typeof QRCode === 'undefined') { el.innerHTML = '<span class="muted small">No se pudo cargar el QR. Usa el enlace.</span>'; return; }
    try { new QRCode(el, { text: joinUrl(j.code), width: 220, height: 220, colorDark: '#15121b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); }
    catch (e) { el.innerHTML = '<span class="muted small">No se pudo crear el QR. Usa el enlace.</span>'; }
  }

  /* ---------- acciones de sala ---------- */
  Object.assign(A, {
    'jh-create': () => hostCreate(),
    'jh-resume': async () => { UI.stack = [{ view: 'home', args: {} }]; go('jamHost', {}, true); await hostConnect(); },
    'jh-reconnect': () => { J.room = null; hostConnect(); },
    'jh-exit-ask': () => { UI.confirm = 'jh-exit'; render(); },
    'jh-close': () => { hostLeave(); UI.stack = []; go('home', {}, true); },
    'jh-plays': () => { jam().hostPlays = !jam().hostPlays; emitState(); render(); },
    'jh-kick': el => { const j = jam(); j.kicked.push(el.dataset.id); j.order = j.order.filter(p => p !== el.dataset.id); emitState(); render(); },
    'copy-link': () => {
      const url = joinUrl(jam().code), inp = document.getElementById('join-link');
      const fb = () => { if (inp) { inp.focus(); inp.select(); } toast('Selecciona el enlace y cópialo.', 'warn'); };
      try { navigator.clipboard.writeText(url).then(() => toast('Enlace copiado.'), fb); } catch (e) { fb(); }
    },
    'jh-deal': () => hostDeal(),
    'jh-clues': () => { hostStartClues(); emitState(); render(true); },
    'jh-next': () => { const i = document.getElementById('h-clue'); hostClue(i ? i.value.trim().slice(0, 60) : '', false); },
    'jh-pause': () => {
      const g = jg(); if (!g || (!g.timerEnd && g.timerPausedLeft == null)) return;
      if (g.timerPausedLeft != null) { g.timerEnd = Date.now() + g.timerPausedLeft * 1000; g.timerPausedLeft = null; }
      else g.timerPausedLeft = Math.max(1, Math.ceil((g.timerEnd - Date.now()) / 1000));
      emitState(); render();
    },
    'jh-vote': () => hostStartVote(),
    'jh-myvote': el => { const g = jg(), e = jam().extra, mi = myIdx(); if (g.phase !== 'vote' || mi < 0) return; e.votes[mi] = Number(el.dataset.i); if (allVoted()) closeVote(); else { emitState(); render(); } },
    'jh-close-vote': () => closeVote(false),
    'jh-myguess': () => { const g = jg(), i = document.getElementById('h-guess'); if (!i || !i.value.trim()) return toast('Escribe un intento.', 'warn'); jam().extra.guessText = i.value.trim(); hostGuess(R.guessMatches(g, i.value)); },
    'jh-guess': el => hostGuess(el.dataset.v === '1'),
    'jh-after': () => hostAfterVote(),
    'jh-new': () => hostNewGame(),
    'my-card': () => { UI.myCard = !UI.myCard; UI.cardOpen = false; render(); },
    'my-flip': () => {
      UI.cardOpen = !UI.cardOpen; if (UI.cardOpen) { UI.cardSeen = true; vibrate(30); }
      const c = document.getElementById('card'); if (c) c.classList.toggle('open', UI.cardOpen);
      const b = document.querySelector('[data-a="jp-ready"]'); if (b && UI.cardSeen && !b.textContent.includes('Esperando')) { b.disabled = false; b.classList.add('btn-accent'); }
    },
    // jugador
    'jam-join': () => go('jamJoin', { code: '' }),
    'jp-resume': async () => { if (jamProblem()) return toast(jamProblem(), 'warn'); UI.stack = [{ view: 'home', args: {} }]; go('jamPlayer', {}, true); await playerConnect(Store.join.code); },
    'jn-go': async () => {
      const code = (document.getElementById('jn-code').value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const name = (document.getElementById('jn-name').value || '').trim().slice(0, 20);
      if (code.length < 3) return toast('Escribe el código de la sala.', 'warn');
      if (!name) return toast('Escribe tu nombre.', 'warn');
      if (jam() && jam().code === code) return toast('Esta es tu propia sala: ábrela desde el inicio.', 'warn');
      await ensureMe(); Store.me.name = name; save();
      P.st = null; P.lastSt = ''; UI.cardSeen = false; UI.cardOpen = false;
      UI.stack = [{ view: 'home', args: {} }]; go('jamPlayer', {}, true);
      await playerConnect(code);
    },
    'jp-retry': async () => { P.room = null; await playerConnect(Store.join.code); },
    'jp-leave-ask': () => { UI.confirm = 'jp-leave'; render(); },
    'jp-leave': () => { playerLeave(); UI.stack = []; go('home', {}, true); },
    'jp-ready': () => { const s = P.st; if (!s || !P.room) return; UI.cardOpen = false; P.room.presence({ ready: s.gid, ack: s.gid }).catch(() => {}); s.ready = (s.ready || []).concat(myPlayerIdx()); render(); },
    'jp-clue': () => {
      const s = P.st; if (!s || s.ph !== 'clues' || !P.room) return;
      const i = document.getElementById('p-clue');
      UI.sentClue = `${s.gid}${s.rd}.${s.crd}.${s.t}`;
      P.room.presence({ clue: { k: `${s.gid}.${s.rd}.${s.crd}.${s.t}`, text: i ? i.value.trim().slice(0, 60) : '' } }).catch(() => toast('No se pudo enviar. Inténtalo otra vez.', 'warn'));
      render();
    },
    'jp-vote': async el => {
      const s = P.st; if (!s || s.ph !== 'vote' || !P.room) return;
      try {
        const box = await seal(await hostKeyP(), { k: s.vk, t: Number(el.dataset.i) });
        await P.room.presence({ vote: { k: s.vk, b: box } });
        UI.sentVote = s.gid + s.vk; vibrate(40); render();
      } catch (e) { toast('No se pudo enviar el voto. Inténtalo otra vez.', 'warn'); }
    },
    'jp-guess': () => {
      const s = P.st, i = document.getElementById('p-guess'); if (!s || !i || !i.value.trim()) return toast('Escribe un intento.', 'warn');
      P.room.presence({ guess: { k: s.vk, t: i.value.trim().slice(0, 40) } }).catch(() => {});
      UI.sentGuess = s.gid + s.vk; render();
    }
  });

  /* ---------- arranque ---------- */
  let rq = 0;
  function renderSoon() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; if (UI.view === 'jamHost' || UI.view === 'jamPlayer' || UI.view === 'jamJoin' || UI.view === 'home') render(); }); }
  setInterval(() => {
    if (UI.view !== 'jamPlayer') return;
    const t = playerTimerLeft(); paintTimer(t);
    if (t && !t.p && t.l <= 5 && t.l > 0 && P.lastTick !== t.l && document.getElementById('jtimer')) Sound.play('tick');
    P.lastTick = t ? t.l : null;
  }, 250);
  function onCapsReady() {
    const code = hashCode();
    if (code && !(jam() && jam().code === code)) {
      if (Store.join && Store.join.code === code && Store.me && Store.me.name && Caps.room) { UI.stack = [{ view: 'home', args: {} }]; go('jamPlayer', {}, true); playerConnect(code); }
      else go('jamJoin', { code }, true);
      return;
    }
    if (UI.view === 'home' || UI.view === 'jamJoin') render();
  }
  afterRender.push(() => { if (UI.view === 'jamHost') drawQr(); });
