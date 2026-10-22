import os, pathlib, shutil, time, zipfile
src = pathlib.Path('src')
# UTF-8 y saltos LF siempre (en Windows Python usaría cp1252 y CRLF)
rd = lambda p: pathlib.Path(p).read_text(encoding='utf-8')
wr = lambda p, s: pathlib.Path(p).write_text(s, encoding='utf-8', newline='\n')
strip = lambda s: s.replace("if (typeof module !== 'undefined') module.exports", "if (false) module.exports")
styles = rd(src/'styles.css')
words = strip(rd(src/'words.js'))
rules = strip(rd(src/'rules.js'))
app = rd(src/'app.js').replace('/*JAM*/', rd(src/'jam.js'))

# 1) versión para Claude (artefacto)
t = rd(src/'template.html')
t = t.replace('/*STYLES*/', styles).replace('/*WORDS*/', words).replace('/*RULES*/', rules).replace('/*APP*/', app)
wr('dist/impostor.html', t)

# 2) versión web independiente (PWA + salas sin cuenta por el servidor de server/)
# Dirección del servidor de salas: variable RELAY_URL o server/relay-url.txt (wss://…)
relay_file = pathlib.Path('server/relay-url.txt')
relay = os.environ.get('RELAY_URL') or (relay_file.read_text(encoding='utf-8').strip() if relay_file.exists() else '')
# Enlace de donación (Ko-fi, Buy Me a Coffee…): variable DONAR_URL o web/donar-url.txt. Vacío = sin botón
donar_file = pathlib.Path('web/donar-url.txt')
donar = os.environ.get('DONAR_URL') or (donar_file.read_text(encoding='utf-8').strip() if donar_file.exists() else '')
out = pathlib.Path('dist/web'); out.mkdir(parents=True, exist_ok=True)
old = {f for f in out.rglob('*') if f.is_file()}
w = rd('web/template.html')
w = w.replace('/*STYLES*/', styles).replace('/*WORDS*/', words).replace('/*RULES*/', rules).replace('/*ROOM*/', rd(src/'relay-room.js')).replace('/*APP*/', app).replace('__RELAY_URL__', relay).replace('__DONAR_URL__', donar)
wr(out/'index.html', w)
wr(out/'sw.js', rd('web/sw.js').replace('__VERSION__', time.strftime('%Y%m%d%H%M%S')))
for f in ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable.png']: shutil.copy(pathlib.Path('web')/f, out/f)
shutil.copytree('web/vendor', out/'vendor', dirs_exist_ok=True)
# quitar archivos que ya no se generan (sin borrar carpetas: en Windows OneDrive o el editor pueden tenerlas abiertas)
made = {out/'index.html', out/'sw.js'} | {out/f.name for f in pathlib.Path('web').glob('*') if f.suffix in ('.png', '.webmanifest')} | {out/'vendor'/f.relative_to('web/vendor') for f in pathlib.Path('web/vendor').rglob('*') if f.is_file()}
for f in old - made: f.unlink()
with zipfile.ZipFile('dist/el-impostor-web.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(out.rglob('*')):
        if f.is_file(): z.write(f, f.relative_to(out).as_posix())
print('artefacto', len(t), 'bytes · web', len(w), 'bytes · servidor de salas:', relay or '(sin configurar)')
