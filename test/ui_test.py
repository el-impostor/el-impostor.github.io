"""Pruebas de interfaz en un navegador real (Chromium, viewport de móvil)."""
import sys, pathlib, re, json
from playwright.sync_api import sync_playwright

URL = pathlib.Path('dist/impostor.html').resolve().as_uri()
SHOTS = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'shots'); SHOTS.mkdir(exist_ok=True)
fails, errors = [], []

def check(cond, msg):
    if not cond: fails.append(msg); print('FALLA:', msg)

def click(page, sel):
    page.locator(sel).first.click()

def store(page):
    return page.evaluate("JSON.parse(localStorage.getItem('impostor.v1'))")

def play_to_end(page, mode_label, shots=False):
    """Juega una partida entera desde la pantalla de intro."""
    click(page, '[data-a="deal"]')
    g = store(page)['game']; n = len(g['players'])
    # revelación privada
    for i in range(n):
        name = g['players'][i]['name']
        check(page.locator('.pass-name').inner_text().strip().lower() == name.lower(), f'{mode_label}: pase a {name}')
        # en la pantalla de pase no debe aparecer ninguna palabra secreta
        html = page.content()
        for w in [g['secret']['w'], g['secret'].get('imp') or '@@@']:
            check(re.search(r'cb-word[^<]*>' + re.escape(w), html) is None, f'{mode_label}: palabra visible en pantalla de pase')
        click(page, '[data-a="rv-me"]')
        check(page.locator('[data-a="rv-done"]').is_disabled(), f'{mode_label}: no se puede pasar sin ver')
        btn = page.locator('#cardBtn')
        if btn.get_attribute('data-hold'):
            btn.dispatch_event('pointerdown'); page.dispatch_event('body', 'pointerup')
        else:
            btn.click()
            check('open' in page.locator('#card').get_attribute('class'), f'{mode_label}: tarjeta abierta')
            if shots and i < 2: page.wait_for_timeout(650); page.screenshot(path=str(SHOTS / f'reveal_{i}.png'))
        click(page, '[data-a="rv-done"]')
    # rondas
    guard = 0
    while guard < 200:
        guard += 1
        view = page.evaluate("document.getElementById('app').dataset.view")
        if view == 'clues':
            if shots and guard < 3: page.screenshot(path=str(SHOTS / f'clues_{mode_label}.png'))
            inp = page.locator('#clue-in')
            if inp.count(): inp.fill('pista %d' % (guard % 3))
            click(page, '[data-a="clue-next"]')
        elif view == 'debate':
            click(page, '[data-a="to-vote"]')
        elif view == 'vote':
            if page.locator('[data-a="v-sel"]').count():
                page.locator('.vbtn').first.click(); click(page, '[data-a="v-confirm"]')
            elif page.locator('[data-a="sv-open"]').count():
                click(page, '[data-a="sv-open"]')
            else:
                page.locator('[data-a="sv-cast"]').first.click()
        elif view == 'voteResult':
            if page.locator('[data-a="g-manual"]').count():
                page.locator('[data-a="g-manual"][data-v="0"]').click()
            if shots: page.screenshot(path=str(SHOTS / f'voteresult_{mode_label}.png'))
            click(page, '[data-a="vr-next"]')
        elif view == 'end':
            break
        else:
            fails.append(f'{mode_label}: vista inesperada {view}'); break
    check(page.evaluate("document.getElementById('app').dataset.view") == 'end', f'{mode_label}: llega al final')
    if shots: page.screenshot(path=str(SHOTS / f'end_{mode_label}.png'), full_page=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and not 'fonts' in m.text and errors.append(m.text))
    page.goto(URL); page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / 'home.png'))

    # configuración
    click(page, '[data-a="nav"][data-to="setup"]')
    page.screenshot(path=str(SHOTS / 'setup.png'), full_page=True)
    # validación: nombre duplicado
    page.fill('#pl-1', 'ana'); page.wait_for_timeout(50)
    check(page.locator('#startBtn').is_disabled(), 'nombre duplicado bloquea el inicio')
    page.fill('#pl-1', 'Bea')
    check(not page.locator('#startBtn').is_disabled(), 'nombre corregido desbloquea')
    # categorías
    click(page, '[data-a="nav"][data-to="cats"]')
    page.screenshot(path=str(SHOTS / 'cats.png'), full_page=True)
    click(page, '[data-a="cat-none"]'); click(page, '[data-a="back"]')
    check(page.locator('#startBtn').is_disabled(), 'sin categorías bloquea')
    click(page, '[data-a="nav"][data-to="cats"]'); click(page, '[data-a="cat-family"]'); click(page, '[data-a="back"]')

    # palabras personalizadas
    click(page, '[data-a="back"]')  # a inicio
    click(page, '[data-a="nav"][data-to="words"]')
    click(page, '[data-a="new-list"]')
    page.fill('#cl-name', 'Profes del insti')
    page.fill('#imp-ta', 'Martínez, García / Gómez\nLópez\nlopez\nRuiz')
    click(page, '[data-a="imp-do"]')
    st = store(page); lst = [c for c in st['custom'] if c['name'] == 'Profes del insti']
    check(lst and len(lst[0]['words']) == 4, 'importación masiva con duplicado omitido: %s' % (lst and [w['w'] for w in lst[0]['words']]))
    check(lst and any(w['w'] == 'García' and w['sim'] == 'Gómez' for w in lst[0]['words']), 'pareja con /')
    page.fill('#nw-w', 'Ruiz'); click(page, '[data-a="w-add"]')
    check(len(store(page)['custom'][-1]['words']) == 4, 'duplicado individual rechazado')
    page.fill('#nw-w', 'Fernández'); page.fill('#nw-s', 'Hernández'); click(page, '[data-a="w-add"]')
    check(page.locator('.note.warn').count() > 0, 'aviso de pocas palabras')
    page.locator('[data-a="w-fav"]').first.click()
    page.locator('[data-a="w-off"]').nth(1).click()
    page.locator('[data-a="w-edit"]').first.click(); page.fill('#ew-w', 'Martínez Soria'); click(page, '[data-a="w-save"]')
    page.screenshot(path=str(SHOTS / 'wordedit.png'), full_page=True)
    # persistencia tras recargar
    page.reload(); page.wait_for_timeout(300)
    st = store(page); lst = [c for c in st['custom'] if c['name'] == 'Profes del insti'][0]
    check(any(w['w'] == 'Martínez Soria' for w in lst['words']), 'edición persiste')
    check(len(lst['words']) == 5, 'palabras persisten tras recargar')
    check(len([k for k, v in st['wordState'].items() if k.startswith(lst['id']) and v.get('off')]) == 1, 'desactivada persiste')
    check(len([k for k, v in st['wordState'].items() if k.startswith(lst['id']) and v.get('fav')]) == 1, 'favorita persiste')
    # añadir palabra a categoría oficial
    page.evaluate("document.querySelector('[data-a=nav][data-to=words]').click()")
    page.locator('[data-a="cat-edit"][data-id="animales"]').click()
    page.fill('#nw-w', 'ornitorrinco'); click(page, '[data-a="w-add"]')
    check(store(page)['added']['animales'][0]['w'] == 'ornitorrinco', 'añadir a categoría oficial')
    page.goto(URL); page.wait_for_timeout(300)

    # partida clásica completa con capturas
    click(page, '[data-a="quick"]'); page.screenshot(path=str(SHOTS / 'players.png'), full_page=True); click(page, '[data-a="pl-next"]')
    page.screenshot(path=str(SHOTS / 'intro.png'))
    play_to_end(page, 'clasico', shots=True)
    st = store(page)
    check(len(st['history']) == 1, 'estadística registrada')
    check(len(st['used']) == 1, 'palabra marcada como usada')

    # todos los modos con distintos ajustes
    for mode in ['parecida', 'categoria', 'ciegas', 'varios', 'infiltrado', 'contrarreloj', 'obligatoria', 'preguntas', 'adivina', 'limitadas', 'aleatorio', 'personalizado']:
        page.goto(URL); page.wait_for_timeout(200)
        click(page, '[data-a="nav"][data-to="modes"]')
        click(page, f'[data-a="mode-pick"][data-id="{mode}"]')
        click(page, '[data-a="nav"][data-to="setup"]')
        # 6 jugadores
        while page.locator('.pl').count() < 6: click(page, '[data-a="pl-add"]'); page.fill('#pl-%d' % (page.locator('.pl').count() - 1), 'Extra%d' % page.locator('.pl').count())
        if mode == 'personalizado':
            click(page, '[data-a="rule"][data-k="voting"][data-v=\'"secret"\']')
            click(page, '[data-a="rule"][data-k="guess"][data-v=\'"partial"\']')
        if mode == 'varios':
            page.screenshot(path=str(SHOTS / 'setup_varios.png'), full_page=True)
        if page.locator('#startBtn').is_disabled():
            fails.append(f'{mode}: configuración inválida: ' + page.locator('#valid').inner_text()); continue
        click(page, '#startBtn')
        play_to_end(page, mode, shots=mode in ('preguntas', 'obligatoria', 'personalizado', 'aleatorio'))

    # ajustes y tema claro
    page.goto(URL); page.wait_for_timeout(200)
    click(page, '[data-a="nav"][data-to="settings"]')
    click(page, '[data-a="set"][data-k="theme"][data-v="light"]')
    page.screenshot(path=str(SHOTS / 'settings_light.png'), full_page=True)
    click(page, '[data-a="back"]'); click(page, '[data-a="nav"][data-to="stats"]')
    page.screenshot(path=str(SHOTS / 'stats_light.png'), full_page=True)
    click(page, '[data-a="back"]'); page.screenshot(path=str(SHOTS / 'home_light.png'))
    # anchura: sin scroll horizontal
    for v in ['home', 'setup', 'cats', 'words', 'stats']:
        page.goto(URL); page.wait_for_timeout(150)
        if v != 'home': page.evaluate(f"document.querySelector('[data-to={v}]') ? document.querySelector('[data-to={v}]').click() : null")
        ow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check(ow <= 0, f'{v}: scroll horizontal {ow}px')
    # versión web: el botón de donación lleva el enlace con el que se ha compilado (web/donar-url.txt); sin enlace, no hay botón
    WEBURL = pathlib.Path('dist/web/index.html').resolve().as_uri()
    df = pathlib.Path('web/donar-url.txt'); donar = df.read_text(encoding='utf-8').strip() if df.exists() else ''
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    ctx.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(WEBURL); pg.wait_for_timeout(300)
    links = pg.locator('a.donar')
    if donar:
        check(links.count() == 1 and links.get_attribute('href') == donar and links.get_attribute('target') == '_blank', 'web: botón de donación con el enlace configurado')
        pg.screenshot(path=str(SHOTS / 'home_donar.png'))
    else: check(links.count() == 0, 'web: sin enlace configurado no hay botón')
    click(pg, '[data-a="nav"][data-to="settings"]')
    check('sin nombres, palabras ni cookies' in pg.locator('main').inner_text(), 'web: ajustes explica lo que cuenta el servidor')
    ctx.close()
    page.goto(URL); page.wait_for_timeout(200)
    check(page.locator('a.donar').count() == 0, 'artefacto: sin botón de donación')
    b.close()

print('Errores JS:', errors[:5])
print('FALLOS:', len(fails))
for f in fails: print(' -', f)
sys.exit(1 if fails or errors else 0)
