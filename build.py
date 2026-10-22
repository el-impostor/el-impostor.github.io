import pathlib, shutil, time, zipfile
src = pathlib.Path('src')
strip = lambda s: s.replace("if (typeof module !== 'undefined') module.exports", "if (false) module.exports")
styles = (src/'styles.css').read_text()
words = strip((src/'words.js').read_text())
rules = strip((src/'rules.js').read_text())
app = (src/'app.js').read_text().replace('/*JAM*/', (src/'jam.js').read_text())

# 1) versión para Claude (artefacto)
t = (src/'template.html').read_text()
t = t.replace('/*STYLES*/', styles).replace('/*WORDS*/', words).replace('/*RULES*/', rules).replace('/*APP*/', app)
pathlib.Path('dist/impostor.html').write_text(t)

# 2) versión web independiente (PWA + salas sin cuenta)
out = pathlib.Path('dist/web'); out.mkdir(parents=True, exist_ok=True)
w = pathlib.Path('web/template.html').read_text()
w = w.replace('/*STYLES*/', styles).replace('/*WORDS*/', words).replace('/*RULES*/', rules).replace('/*PEER*/', (src/'peer-room.js').read_text()).replace('/*APP*/', app)
(out/'index.html').write_text(w)
(out/'sw.js').write_text(pathlib.Path('web/sw.js').read_text().replace('__VERSION__', time.strftime('%Y%m%d%H%M%S')))
for f in ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable.png']: shutil.copy(pathlib.Path('web')/f, out/f)
with zipfile.ZipFile('dist/el-impostor-web.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(out.iterdir()): z.write(f, f.name)
print('artefacto', len(t), 'bytes · web', len(w), 'bytes')
