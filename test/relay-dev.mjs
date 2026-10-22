/* Arranca el servidor de salas en local (wrangler dev) para las pruebas.
   También se puede usar desde la terminal: node test/relay-dev.mjs [puerto]  → deja el servidor abierto. */
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
const WIN = process.platform === 'win32';

export async function startRelay(vars = {}, port = 8790 + Math.floor(Math.random() * 100)) {
  const state = mkdtempSync(path.join(tmpdir(), 'impostor-salas-'));   // estado limpio en cada arranque
  const args = [path.join(SERVER, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state, '--log-level', 'warn'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  // wrangler con el mismo node que ejecuta esto (no depende de que npx esté en el PATH)
  const proc = spawn(process.execPath, args, { cwd: SERVER, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const url = `ws://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) {}
    if (proc.exitCode != null) throw new Error('wrangler dev se ha cerrado:\n' + log);
    await new Promise(r => setTimeout(r, 500));
    if (i === 119) throw new Error('wrangler dev no arranca:\n' + log);
  }
  return {
    url, port, log: () => log,
    stop: async () => {
      try { if (WIN) execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' }); else proc.kill('SIGTERM'); } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
      try { rmSync(state, { recursive: true, force: true }); } catch (e) {}
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = await startRelay({}, Number(process.argv[2]) || 8787);
  console.log(`Servidor de salas en ${r.url}  (Ctrl+C para parar)`);
  const stop = async () => { await r.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
