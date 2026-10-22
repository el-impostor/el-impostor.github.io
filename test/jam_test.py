"""Prueba del modo sala con 1 anfitrión + 3 móviles (contextos de navegador separados).
- Normal: se simula la capacidad `room` de Claude con un concentrador en Python.
- MODE=web: versión web contra el servidor de salas real (server/) con wrangler dev en local.
  Playwright intercepta cada WebSocket: registra lo que viaja y puede cortar la conexión de un móvil."""
import sys, json, pathlib, re, time
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

# ---------- versión web: servidor de salas real en local ----------
RELAY = None
if WEB:
    import subprocess, shutil, socket, urllib.request, time, atexit
    NODE = shutil.which('node') or 'C:/Program Files/nodejs/node.exe'
    _s = socket.socket(); _s.bind(('127.0.0.1', 0)); PORT = _s.getsockname()[1]; _s.close()
    relay_proc = subprocess.Popen([NODE, 'test/relay-dev.mjs', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    def stop_relay():
        if os.name == 'nt': subprocess.run(['taskkill', '/pid', str(relay_proc.pid), '/T', '/F'], capture_output=True)
        else: relay_proc.terminate()
    atexit.register(stop_relay)
    for _ in range(240):
        try: urllib.request.urlopen(f'http://127.0.0.1:{PORT}/', timeout=1); break
        except Exception: time.sleep(0.5)
    else:
        print('No arranca el servidor de salas (wrangler dev)'); sys.exit(1)
    RELAY = f'ws://127.0.0.1:{PORT}'
SOCKS, BLOCK, REFUSE = {}, set(), []   # conexión actual de cada móvil · móviles «sin cobertura» · conexiones por rechazar
def route_ws(name):
    def handler(ws):
        # sin cobertura: se rechaza desde pump() (cerrar dentro del handler bloquea la API síncrona de Playwright)
        if name in BLOCK: REFUSE.append(ws); return
        server = ws.connect_to_server(); SOCKS[name] = (ws, server)
        def up(msg):
            if name in BLOCK: return
            log_up(name, msg); server.send(msg)
        def down(msg):
            if name not in BLOCK: ws.send(msg)
        ws.on_message(up); server.on_message(down)
    return handler
def log_up(name, msg):
    if not isinstance(msg, str) or msg == 'ping': return
    try: m = json.loads(msg)
    except Exception: return
    if m.get('t') == 'emit': emits_log.append({'topic': m['topic'], 'data': m['data']})
    if m.get('t') in ('pres', 'hello') and isinstance(m.get('presence'), dict): members.setdefault('web', {})[name] = {'presence': m['presence']}
def cut(name):
    """El móvil pierde la cobertura: se corta su conexión y no puede reconectar hasta restore()."""
    BLOCK.add(name); sk = SOCKS.pop(name, None)
    for r in (sk or ()):
        try: r.close()
        except Exception: pass
def restore(name): BLOCK.discard(name)

WAKE_STUB = "window.__wake = 0; Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { window.__wake++; return { release: async () => {}, addEventListener: () => {} }; } } });"
# en el anfitrión, descifrar tarda un poco (como en un móvil lento): así llegan presencias mientras descifra
SLOW_DECRYPT = r"""
(() => { const d = SubtleCrypto.prototype.decrypt;
  SubtleCrypto.prototype.decrypt = function (...a) { return new Promise(r => setTimeout(r, 150)).then(() => d.apply(this, a)); }; })();
"""
queue, members, emits_log = [], {}, []   # members[room] = {peer: {'page':page,'presence':{}}}
def pump(rounds=6, wait=60):
    any_page = next(iter(pages.values()))
    for _ in range(rounds):
        any_page.wait_for_timeout(wait)
        while REFUSE:
            try: REFUSE.pop().close()
            except Exception: pass
        while queue:
            page, m = queue.pop(0)
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
def broadcast(room_name, joined):
    room = members[room_name]
    msg = {'t': 'peers', 'room': room_name, 'joined': joined, 'peers': [{'peer': p, 'presence': i['presence']} for p, i in room.items()]}
    for p, info in list(room.items()):
        try: info['page'].evaluate('m => window.__hubRecv(m)', msg)
        except Exception: pass

def store(pg): return pg.evaluate("JSON.parse(localStorage.getItem('impostor.v1'))")
def view(pg): return pg.evaluate("document.getElementById('app').dataset.view")
def click(pg, sel): pg.locator(sel).first.click()
def wait_until(cond, secs=15):
    end = time.time() + secs
    while time.time() < end:
        try:
            if cond(): return True
        except Exception: pass
        pump(1, 100)
    return False
def note(pg):
    """aviso de conexión que se ve en pantalla (versión web)"""
    return pg.locator('.conn-note').inner_text() if pg.locator('.conn-note').count() else ''

with sync_playwright() as p:
    b = p.chromium.launch()
    pages = {}
    def new_page(name, can_edit):
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
        ctx.add_init_script(f'window.__CAN_EDIT = {"true" if can_edit else "false"};' + (f'window.IMPOSTOR_RELAY = {json.dumps(RELAY)};' + WAKE_STUB if WEB else FAKE) + (SLOW_DECRYPT if can_edit else ''))
        ctx.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        if WEB: ctx.route_web_socket(re.compile(r'^ws://127\.0\.0\.1'), route_ws(name))
        else: ctx.expose_binding('__hubSend', lambda src, s: queue.append((src['page'], json.loads(s))))
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
    if WEB: check(all(pg.evaluate('window.__wake') >= 1 for pg in [host] + players), 'con la sala abierta se pide mantener la pantalla encendida')

    # ---------- situaciones reales (versión web) ----------
    name_of = lambda pg: next(n for n, x in pages.items() if x is pg)
    LATE = []
    def web_host_drop():
        cut('host')
        check(wait_until(lambda: 'Sin conexión' in note(host), 10), 'el anfitrión ve que ha perdido la conexión')
        check(wait_until(lambda: all('anfitrión se ha desconectado' in note(pg) for pg in players), 10), 'los jugadores ven que el anfitrión se ha ido')
        pump(15, 100)   # un rato fuera
        restore('host')
        check(wait_until(lambda: not note(host) and all(not note(pg) for pg in players), 25), 'al volver el anfitrión desaparecen los avisos')
    def web_player_drop():
        pg = players[2]; n = name_of(pg); cut(n)
        check(wait_until(lambda: 'Sin conexión' in note(pg), 10), f'{n} ve que no tiene conexión')
        check(wait_until(lambda: n in note(host), 10), f'el anfitrión ve que {n} se ha desconectado')
        restore(n)
        check(wait_until(lambda: not note(pg) and n not in note(host), 25), f'{n} vuelve y desaparecen los avisos')
    def web_late_join():
        pg = new_page('Óscar', False); pg.goto(URL + '#sala-' + code); pg.wait_for_timeout(300)
        pg.fill('#jn-name', 'Óscar'); click(pg, '[data-a="jn-go"]')
        check(wait_until(lambda: 'partida en curso' in pg.locator('main').inner_text().lower(), 15), 'quien entra tarde ve que hay una partida en curso')
        LATE.append(pg)
    def web_host_reload():
        before = store(host)['jam']['game']['phase']
        host.reload()
        check(wait_until(lambda: view(host) == 'jamHost' and host.locator('.dot-on').count() > 0, 20), 'al recargar, el anfitrión vuelve solo a su sala')
        check(store(host)['jam']['game']['phase'] == before, 'la partida sigue donde estaba')
        check(wait_until(lambda: all(not note(pg) for pg in players), 20), 'los jugadores siguen conectados tras recargar el anfitrión')
    def web_lost_vote():
        pg = next((x for x in players if x.locator('[data-a="jp-vote"]').count()), None)
        if not pg: return
        n = name_of(pg)
        idx = [pl['pid'] for pl in store(host)['jam']['game']['players']].index(store(pg)['me']['pid'])
        cut(n); wait_until(lambda: 'Sin conexión' in note(pg), 10)
        pg.locator('[data-a="jp-vote"]').first.click(); pump(6)
        check(str(idx) not in store(host)['jam']['extra']['votes'], 'sin conexión el voto aún no llega')
        restore(n)
        check(wait_until(lambda: str(idx) in store(host)['jam']['extra']['votes'] or store(host)['jam']['game']['phase'] != 'vote', 25), 'el voto hecho sin conexión llega al reconectar')

    STALE = []   # votos reales de la primera partida, para reenviarlos en la segunda
    def peer_of(pg):
        for room_name, room in members.items():
            for peer, info in room.items():
                if info.get('page') is pg: return (room_name, []), info
    def play_game(tag, shots=False, reload_mid=False, capture=False, replay=False, faults=None):
        done = set()
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
            # cortes de conexión y entradas tardías, una vez cada uno
            if faults == 'g1' and ph == 'clues':
                for k, fn in (('host', web_host_drop), ('player', web_player_drop), ('late', web_late_join)):
                    if k not in done: done.add(k); fn(); break
                else: k = None
                if k: continue
            if faults == 'g2' and ph == 'debate' and 'reload' not in done:
                done.add('reload'); web_host_reload(); continue
            if faults == 'g2' and ph == 'vote' and 'vote' not in done:
                done.add('vote'); web_lost_vote(); continue
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
                if capture and g['round'] == 1 and e['voteN'] == 0:
                    # votos casi a la vez: el anfitrión vota primero y los demás sin esperar entre uno y otro.
                    # Algunos llegan mientras el anfitrión descifra otro voto; aun así la votación se cierra sola.
                    if host.locator('[data-a="jh-myvote"]').count(): host.locator('[data-a="jh-myvote"]').first.click(); pump(2)
                    voters = [pg for pg in players if pg.locator('[data-a="jp-vote"]').count()]
                    for pg in voters: pg.locator('[data-a="jp-vote"]').first.click()
                    pump(8)
                    x = store(host)['jam']
                    check(x['game']['phase'] != 'vote' or x['extra']['voteN'] == 1, f'{tag}: con votos simultáneos la votación se cierra sola ({len(x["extra"]["votes"])} votos)')
                    if not WEB: STALE.extend((pg, dict(peer_of(pg)[1]['presence']['vote'])) for pg in voters)
                for pg in players:
                    if pg.locator('[data-a="jp-vote"]').count():
                        pg.locator('[data-a="jp-vote"]').first.click(); pump(2)
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
        # privacidad: la palabra no viaja en claro antes del final.
        # Se busca como palabra entera: una palabra corta («up», «ex») puede aparecer por casualidad
        # dentro de un texto en base64 (la clave pública del anfitrión) o de un nombre.
        word_re = re.compile(r'(?<![\w+/=])' + re.escape(secret) + r'(?![\w+/=])', re.IGNORECASE)
        for m in emits_log:
            if m['topic'] == 'st' and m['data'].get('ph') != 'end' and m['data'].get('gid') == g['id']:
                if word_re.search(json.dumps(m['data'], ensure_ascii=False)):
                    check(False, f'{tag}: la palabra secreta aparece en el estado público ({m["data"]["ph"]})'); break
            if m['topic'] == 'card':
                check(set(m['data']) == {'to', 'gid', 'iv', 'ct'}, f'{tag}: la tarjeta solo lleva datos cifrados: {sorted(m["data"])}')
                check(not word_re.search(json.dumps(m['data'], ensure_ascii=False)), f'{tag}: la tarjeta viaja cifrada')
        if WEB:
            # en la web el servidor de salas no debe poder leer nada de la partida
            sts = [m['data'] for m in emits_log if m['topic'] == 'st']
            check(sts and all(set(d) == {'c', 'hp', 'k', 'enc'} for d in sts), f'{tag}: todo el estado público viaja cifrado')
            check(not any(word_re.search(json.dumps(m['data'], ensure_ascii=False)) for m in emits_log), f'{tag}: la palabra no aparece en nada de lo que emite el anfitrión')
        # votos (y en la web también pistas e intentos) cifrados en la presencia
        for room in members.values():
            for info in room.values():
                v = info['presence'].get('vote')
                if v: check('t' not in v and 'b' in v, f'{tag}: el voto viaja cifrado')
                if WEB:
                    for k in ('clue', 'guess'):
                        x = info['presence'].get(k)
                        if x: check('b' in x and 'text' not in x and 't' not in x, f'{tag}: {k} viaja cifrado')
        emits_log.clear()

    play_game('clásico', shots=True, capture=True, faults='g1' if WEB else None)
    if WEB:
        check(len(LATE) == 1, 'ha entrado alguien tarde'); players.extend(LATE)
    # segunda partida: otra configuración y un jugador recarga a mitad
    click(host, '[data-a="jh-new"]'); pump(4)
    click(host, '[data-a="nav"][data-to="setup"]')
    click(host, '[data-a="nav"][data-to="modes"]'); click(host, '[data-a="mode-pick"][data-id="aleatorio"]')
    click(host, '[data-a="nav"][data-to="setup"]')
    host.screenshot(path=str(SHOTS / 'jam_setup.png'), full_page=True)
    click(host, '[data-a="back"]')
    check(view(host) == 'jamHost', 'volver de reglas lleva a la sala')
    click(host, '[data-a="rule"][data-k="guess"][data-v=\'"win"\']') if host.locator('[data-a="rule"]').count() else None
    play_game('pistas limitadas + recarga', reload_mid=True, replay=True, faults='g2' if WEB else None)
    if WEB: check(len(store(host)['jam']['game']['players']) == 5, 'quien entró tarde juega la partida siguiente')
    b.close()

print('Errores JS:', [e for e in errors][:5])
print('FALLOS:', len(fails))
for f in fails[:20]: print(' -', f)
sys.exit(1 if fails or errors else 0)
