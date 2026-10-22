"""Prueba del modo sala con 1 anfitrión + 3 móviles (contextos de navegador separados).
Se simula la capacidad `room` con un concentrador en Python que reenvía mensajes."""
import sys, json, pathlib
from playwright.sync_api import sync_playwright

import os
WEB = os.environ.get('MODE') == 'web'
URL = pathlib.Path('dist/web/index.html' if WEB else 'dist/impostor.html').resolve().as_uri()
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'shots') / ('web' if WEB else 'claude'); SHOTS.mkdir(parents=True, exist_ok=True)
fails, errors = [], []
def check(c, m):
    if not c: fails.append(m); print('FALLA:', m)

FAKE = r"""
(() => {
  const peerId = 'peer' + Math.random().toString(36).slice(2, 10);
  const rooms = {};
  const send = m => window.__hubSend(JSON.stringify(m));
  function mk(name) {
    const R = { topics: {}, pf: [], list: Object.freeze([]), pres: {} };
    R.api = Object.freeze({
      name,
      emit: async (topic, data) => { send({ t: 'emit', room: name, topic, data, from: peerId }); },
      on: (topic, fn) => { (R.topics[topic] = R.topics[topic] || []).push(fn); return () => {}; },
      presence: async patch => { for (const k in patch) { if (patch[k] === null) delete R.pres[k]; else R.pres[k] = patch[k]; } send({ t: 'pres', room: name, from: peerId, presence: R.pres }); },
      peers: () => R.list,
      onPeers: fn => { R.pf.push(fn); setTimeout(() => fn({ peers: R.list, joined: R.list, left: [], updated: [] }), 0); return () => {}; },
      connected: () => true, onConnection: fn => { setTimeout(() => fn(true), 0); return () => {}; },
      leave: async () => send({ t: 'leave', room: name, from: peerId })
    });
    rooms[name] = R; send({ t: 'join', room: name, from: peerId });
    return R;
  }
  window.__hubRecv = m => {
    const R = rooms[m.room]; if (!R) return;
    if (m.t === 'emit') (R.topics[m.topic] || []).forEach(fn => fn({ topic: m.topic, data: m.data, peer: m.from, by: null, isMe: m.from === peerId, sameTab: m.from === peerId, kind: 'viewer', guest: false }));
    if (m.t === 'peers') {
      const list = Object.freeze(m.peers.map(p => Object.freeze({ peer: p.peer, by: null, isMe: p.peer === peerId, sameTab: p.peer === peerId, kind: 'viewer', guest: false, presence: Object.freeze(p.presence), updatedAt: Date.now() })));
      R.list = list; R.pf.forEach(fn => fn({ peers: list, joined: list.filter(p => (m.joined || []).includes(p.peer)), left: [], updated: [] }));
    }
  };
  const room = { join: async name => (rooms[name] || mk(name)).api };
  const user = { canEdit: async () => window.__CAN_EDIT === true, isOwner: async () => window.__CAN_EDIT === true, id: async () => null };
  window.claude = Object.freeze({ use: async n => n === 'room' ? room : n === 'user' ? user : null });
})();
"""

FAKE_PEER = r"""
(() => {
  const PEERS = {};
  const hub = m => window.__hubSend(JSON.stringify(m));
  class Conn {
    constructor(me, remote, cid) { this._me = me; this.peer = remote; this.cid = cid; this.open = false; this.h = {}; }
    on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); }
    _e(ev, a) { (this.h[ev] || []).forEach(f => f(a)); }
    send(d) { hub({ t: 'data', cid: this.cid, to: this.peer, from: this._me.id, d: JSON.parse(JSON.stringify(d)) }); }
    close() { if (!this.open) return; this.open = false; hub({ t: 'close', cid: this.cid, to: this.peer }); this._e('close'); }
  }
  class Peer {
    constructor(id) { if (typeof id !== 'string') id = 'rnd' + Math.random().toString(36).slice(2, 10); this.id = id; this.h = {}; this.conns = {}; this.disconnected = false; this.destroyed = false; PEERS[id] = this; hub({ t: 'reg', id }); }
    on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); }
    _e(ev, a) { (this.h[ev] || []).forEach(f => f(a)); }
    connect(remote) { const cid = 'c' + Math.random().toString(36).slice(2, 10); const c = new Conn(this, remote, cid); this.conns[cid] = c; hub({ t: 'connect', cid, from: this.id, to: remote }); return c; }
    destroy() { this.destroyed = true; hub({ t: 'unreg', id: this.id }); }
    reconnect() {}
  }
  window.Peer = Peer;
  window.__hubRecv = m => {
    const p = PEERS[m.to]; if (!p) return;
    if (m.t === 'open-peer') p._e('open', p.id);
    else if (m.t === 'error') p._e('error', { type: m.type });
    else if (m.t === 'incoming') { const c = new Conn(p, m.from, m.cid); p.conns[m.cid] = c; p._e('connection', c); setTimeout(() => { c.open = true; c._e('open'); hub({ t: 'opened', cid: m.cid, to: m.from }); }, 0); }
    else if (m.t === 'opened') { const c = p.conns[m.cid]; if (c) { c.open = true; c._e('open'); } }
    else if (m.t === 'data') { const c = p.conns[m.cid]; if (c) c._e('data', m.d); }
    else if (m.t === 'close') { const c = p.conns[m.cid]; if (c && c.open) { c.open = false; c._e('close'); } }
  };
})();
"""
registry = {}
queue, members, emits_log = [], {}, []   # members[room] = {peer: {'page':page,'presence':{}}}
def pump(rounds=6, wait=60):
    any_page = next(iter(pages.values()))
    for _ in range(rounds):
        any_page.wait_for_timeout(wait)
        while queue:
            page, m = queue.pop(0)
            if WEB:
                route_web(page, m); continue
            room = members.setdefault(m['room'], {})
            if m['t'] == 'join':
                room[m['from']] = {'page': page, 'presence': {}}; broadcast(m['room'], [m['from']])
            elif m['t'] == 'pres':
                if m['from'] in room: room[m['from']]['presence'] = m['presence']; broadcast(m['room'], [])
            elif m['t'] == 'leave':
                room.pop(m['from'], None); broadcast(m['room'], [])
            elif m['t'] == 'emit':
                emits_log.append(m)
                for peer, info in list(room.items()):
                    try: info['page'].evaluate('m => window.__hubRecv(m)', m)
                    except Exception: pass
def deliver(page, msg):
    try: page.evaluate('m => window.__hubRecv(m)', msg)
    except Exception: pass
def route_web(page, m):
    t = m['t']
    if t == 'reg':
        if m['id'] in registry and registry[m['id']] is not page: deliver(page, {'t': 'error', 'to': m['id'], 'type': 'unavailable-id'})
        else: registry[m['id']] = page; deliver(page, {'t': 'open-peer', 'to': m['id']})
    elif t == 'unreg':
        if registry.get(m['id']) is page: registry.pop(m['id'], None)
    elif t == 'connect':
        if m['to'] in registry: deliver(registry[m['to']], {'t': 'incoming', 'to': m['to'], 'from': m['from'], 'cid': m['cid']})
        else: deliver(page, {'t': 'error', 'to': m['from'], 'type': 'peer-unavailable'})
    elif t in ('data', 'close', 'opened'):
        if t == 'data' and isinstance(m.get('d'), dict):
            d = m['d']
            if d.get('t') == 'emit': emits_log.append({'topic': d['topic'], 'data': d['data']})
            if d.get('t') == 'pres': members.setdefault('web', {})[m['from']] = {'presence': d['presence']}
        if m['to'] in registry: deliver(registry[m['to']], m)
def broadcast(room_name, joined):
    room = members[room_name]
    msg = {'t': 'peers', 'room': room_name, 'joined': joined, 'peers': [{'peer': p, 'presence': i['presence']} for p, i in room.items()]}
    for p, info in list(room.items()):
        try: info['page'].evaluate('m => window.__hubRecv(m)', msg)
        except Exception: pass

def store(pg): return pg.evaluate("JSON.parse(localStorage.getItem('impostor.v1'))")
def view(pg): return pg.evaluate("document.getElementById('app').dataset.view")
def click(pg, sel): pg.locator(sel).first.click()

with sync_playwright() as p:
    b = p.chromium.launch()
    pages = {}
    def new_page(name, can_edit):
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
        ctx.add_init_script(f'window.__CAN_EDIT = {"true" if can_edit else "false"};' + (FAKE_PEER if WEB else FAKE))
        ctx.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        ctx.expose_binding('__hubSend', lambda src, s: queue.append((src['page'], json.loads(s))))
        pg = ctx.new_page()
        pg.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        pages[name] = pg
        return pg
    host = new_page('host', True)
    players = [new_page(n, False) for n in ['Lucía', 'Marco', 'Nerea']]

    host.goto(URL); host.wait_for_timeout(300)
    check(host.locator('[data-a="jh-create"]').count() == 1, 'el anfitrión ve «Crear sala»')
    host.screenshot(path=str(SHOTS / 'jam_home.png'))
    click(host, '[data-a="jh-create"]'); pump()
    code = store(host)['jam']['code']
    host.fill('#host-name', 'Guille')

    for pg, name in zip(players, ['Lucía', 'Marco', 'Nerea']):
        pg.goto(URL + '#sala-' + code); pg.wait_for_timeout(300)
        check(view(pg) == 'jamJoin', f'{name}: el enlace abre la pantalla de entrar')
        if not WEB: check(pg.locator('[data-a="jh-create"]').count() == 0, f'{name}: un jugador sin edición no puede crear sala')
        pg.fill('#jn-name', name); click(pg, '[data-a="jn-go"]')
        pump(4)
    pump(8)
    host.screenshot(path=str(SHOTS / 'jam_lobby.png'), full_page=True)
    lobby_names = host.locator('.mem-n').all_inner_texts()
    check(len(lobby_names) == 4, 'el anfitrión ve 4 jugadores: %s' % lobby_names)
    players[0].screenshot(path=str(SHOTS / 'jam_player_lobby.png'))
    check('Lucía' in players[1].locator('main').inner_text(), 'los jugadores ven la lista de la sala')

    STALE = []   # votos reales de la primera partida, para reenviarlos en la segunda
    def peer_of(pg):
        for room_name, room in members.items():
            for peer, info in room.items():
                if info.get('page') is pg: return (room_name, []), info
    def play_game(tag, shots=False, reload_mid=False, capture=False, replay=False):
        click(host, '[data-a="jh-deal"]'); pump(10)
        hs = store(host); g = hs['jam']['game']
        check(g is not None, f'{tag}: partida creada')
        secret = g['secret']['w']
        # cada jugador recibe SU tarjeta y coincide con su papel
        for pg in players:
            st = store(pg); me = st['me']['pid']; card = st.get('myCard')
            idx = [pl['pid'] for pl in g['players']].index(me)
            role = g['players'][idx]['role']
            check(card is not None, f'{tag}: {st["me"]["name"]} recibe su tarjeta')
            if card:
                check(card['kind'] == ('impostor' if role == 'impostor' and g['rules']['impostorInfo'] != 'unaware' else 'crew'), f'{tag}: tipo de tarjeta correcto')
                if role == 'impostor' and g['rules']['impostorInfo'] == 'none': check(card['word'] == '', f'{tag}: el impostor no recibe la palabra')
                if role == 'crew': check(card['word'] == secret, f'{tag}: el jugador recibe la palabra')
        if reload_mid:
            players[2].reload(); players[2].wait_for_timeout(400); pump(12)
            check(store(players[2]).get('myCard') is not None, f'{tag}: tras recargar recupera la tarjeta')
        # revelar y listo
        for i, pg in enumerate(players):
            if shots and i == 0: pg.screenshot(path=str(SHOTS / 'jam_player_card_closed.png'))
            click(pg, '[data-a="my-flip"]')
            if shots and i == 0: pg.wait_for_timeout(650); pg.screenshot(path=str(SHOTS / 'jam_player_card.png'))
            click(pg, '[data-a="jp-ready"]'); pump(2)
        pump(4)
        if shots: host.screenshot(path=str(SHOTS / 'jam_host_reveal.png'))
        click(host, '[data-a="jh-clues"]'); pump(4)
        byname = {store(pg)['me']['pid']: pg for pg in players}
        guard = 0
        while guard < 120:
            guard += 1
            g = store(host)['jam']['game']; ph = g['phase']
            if ph == 'clues':
                cur = g['players'][g['order'][g['turn']]]['pid']
                if cur in byname:
                    pg = byname[cur]; pump(2)
                    if shots and guard < 3: pg.screenshot(path=str(SHOTS / 'jam_player_turn.png'))
                    if pg.locator('#p-clue').count(): pg.fill('#p-clue', f'pista {tag[:6]} {guard}')
                    click(pg, '[data-a="jp-clue"]')
                else:
                    if host.locator('#h-clue').count(): host.fill('#h-clue', 'mía ' + str(guard))
                    click(host, '[data-a="jh-next"]')
                pump(4)
            elif ph == 'debate':
                click(host, '[data-a="jh-vote"]'); pump(4)
            elif ph == 'vote':
                e = store(host)['jam']['extra']
                if replay and not WEB and g['round'] == 1 and STALE:
                    # un voto de la partida anterior que sigue en la presencia no debe contar en esta
                    pg, vote = STALE[0]; peer, info = peer_of(pg)
                    info['presence'] = dict(info['presence'], vote=vote); broadcast(*peer); pump(4)
                    idx = [pl['pid'] for pl in g['players']].index(store(pg)['me']['pid'])
                    check(str(idx) not in store(host)['jam']['extra']['votes'], f'{tag}: no cuenta un voto de la partida anterior')
                    replay = False
                for pg in players:
                    if pg.locator('[data-a="jp-vote"]').count():
                        pg.locator('[data-a="jp-vote"]').first.click(); pump(2)
                        if capture and not WEB and g['round'] == 1:
                            STALE.append((pg, dict(peer_of(pg)[1]['presence']['vote'])))
                if shots and guard < 30: players[0].screenshot(path=str(SHOTS / 'jam_player_voted.png'))
                if host.locator('[data-a="jh-myvote"]').count(): host.locator('[data-a="jh-myvote"]').first.click()
                pump(6)
                if store(host)['jam']['game']['phase'] == 'vote':
                    if host.locator('[data-a="jh-close-vote"]:not([disabled])').count(): click(host, '[data-a="jh-close-vote"]'); pump(3)
            elif ph == 'voteResult':
                if g.get('guessState') == 'pending':
                    el = g['players'][g['lastVote']['eliminated']]['pid']
                    if el in byname:
                        pg = byname[el]; pump(2)
                        if pg.locator('#p-guess').count(): pg.fill('#p-guess', 'nolasé'); click(pg, '[data-a="jp-guess"]'); pump(5)
                    elif host.locator('#h-guess').count(): host.fill('#h-guess', 'nolasé'); click(host, '[data-a="jh-myguess"]')
                    if store(host)['jam']['game'].get('guessState') == 'pending': click(host, '[data-a="jh-guess"][data-v="0"]')
                    pump(3)
                if shots: players[1].screenshot(path=str(SHOTS / 'jam_player_result.png'))
                click(host, '[data-a="jh-after"]'); pump(4)
            elif ph == 'end':
                break
        pump(6)
        check(store(host)['jam']['game']['phase'] == 'end', f'{tag}: termina la partida')
        old = [c['text'] for c in store(host)['jam']['game']['clues'] if c['text'].startswith('pista ') and not c['text'].startswith(f'pista {tag[:6]} ')]
        check(not old, f'{tag}: no se cuelan pistas de la partida anterior: {old}')
        for pg in players:
            check(view(pg) == 'jamPlayer' and pg.locator('.win').count() == 1, f'{tag}: el jugador ve el final')
        if shots:
            host.screenshot(path=str(SHOTS / 'jam_host_end.png'), full_page=True)
            players[0].screenshot(path=str(SHOTS / 'jam_player_end.png'), full_page=True)
        # privacidad: la palabra no viaja en claro antes del final
        for m in emits_log:
            if m['topic'] == 'st' and m['data'].get('ph') != 'end' and m['data'].get('gid') == g['id']:
                if secret.lower() in json.dumps(m['data'], ensure_ascii=False).lower():
                    check(False, f'{tag}: la palabra secreta aparece en el estado público ({m["data"]["ph"]})'); break
            if m['topic'] == 'card':
                check(secret.lower() not in json.dumps(m['data'], ensure_ascii=False).lower(), f'{tag}: la tarjeta viaja cifrada')
        # votos cifrados en la presencia
        for room in members.values():
            for info in room.values():
                v = info['presence'].get('vote')
                if v: check('t' not in v and 'b' in v, f'{tag}: el voto viaja cifrado')
        emits_log.clear()

    play_game('clásico', shots=True, capture=True)
    # segunda partida: otra configuración y un jugador recarga a mitad
    click(host, '[data-a="jh-new"]'); pump(4)
    click(host, '[data-a="nav"][data-to="setup"]')
    click(host, '[data-a="nav"][data-to="modes"]'); click(host, '[data-a="mode-pick"][data-id="aleatorio"]')
    click(host, '[data-a="nav"][data-to="setup"]')
    host.screenshot(path=str(SHOTS / 'jam_setup.png'), full_page=True)
    click(host, '[data-a="back"]')
    check(view(host) == 'jamHost', 'volver de reglas lleva a la sala')
    click(host, '[data-a="rule"][data-k="guess"][data-v=\'"win"\']') if host.locator('[data-a="rule"]').count() else None
    play_game('pistas limitadas + recarga', reload_mid=True, replay=True)
    b.close()

print('Errores JS:', [e for e in errors][:5])
print('FALLOS:', len(fails))
for f in fails[:20]: print(' -', f)
sys.exit(1 if fails or errors else 0)
