"""Vuelve a ejecutar build.py cada vez que cambia algo en src/ o web/.
Uso: python3 watch.py   (Ctrl+C para parar). No necesita dependencias."""
import pathlib, subprocess, sys, time
ROOT = pathlib.Path(__file__).resolve().parent
DIRS = [ROOT/'src', ROOT/'web']

def snapshot():
    return {p: p.stat().st_mtime_ns for d in DIRS for p in d.rglob('*') if p.is_file()}

def build():
    r = subprocess.run([sys.executable, 'build.py'], cwd=ROOT)
    print(time.strftime('[%H:%M:%S]'), 'compilado' if r.returncode == 0 else 'ERROR al compilar', flush=True)

print('Vigilando src/ y web/ …', flush=True)
build()
last = snapshot()
while True:
    try:
        time.sleep(0.5)
        now = snapshot()
        if now != last:
            time.sleep(0.3)   # dejar que el editor termine de guardar
            last = snapshot()
            build()
    except KeyboardInterrupt:
        break
    except OSError:
        pass   # archivo a medio guardar o borrado: se reintenta en la siguiente vuelta
