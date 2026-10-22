# El Impostor — notas del proyecto

Juego de deducción social en español de España. Dos formas de jugar:
- **Un solo móvil**: se pasa el teléfono para ver los papeles.
- **Sala**: cada jugador en su móvil, entrando por QR o enlace.

## Dos versiones que salen del mismo código
- `dist/impostor.html`: artefacto de Claude (claude.ai). La sala usa la capacidad `room` de Claude y solo admite gente con cuenta y acceso compartido. Las imágenes se suben con `assets`.
- `dist/web/`: versión web independiente (PWA instalable). La sala va móvil a móvil con PeerJS: el móvil del anfitrión hace de centro y no hace falta cuenta. Se sube a un hosting estático (Netlify Drop, GitHub Pages…). `dist/el-impostor-web.zip` es esa carpeta comprimida.

## Estructura
- `src/words.js`: banco de palabras (21 categorías, formato `"palabra|parecida"`) y preguntas sugeridas.
- `src/rules.js`: lógica pura, sin DOM. Incluye:
  - modos (13), reglas por defecto y ajustes recomendados;
  - catálogo (oficiales + personalizadas + imágenes) y bolsa de palabras;
  - validación de la configuración;
  - reparto de papeles, tarjetas, turnos, votos, victoria y adivinar;
  - `statusAfterVote` (seguir jugando o fin).
- `src/app.js`: interfaz de un solo móvil, almacenamiento (`localStorage`, clave `impostor.v1`), sonidos (Web Audio) y editor de palabras/imágenes. `/*JAM*/` marca dónde se inserta `jam.js`.
- `src/jam.js`: modo sala con anfitrión y jugadores. El anfitrión emite el estado público por el tema `st` y la tarjeta de cada jugador por `card`. Los jugadores escriben solo en su `presence` (nombre, clave pública, listo, pista, voto, intento). Tarjetas y votos van cifrados con ECDH P-256 + AES-GCM.
- `src/peer-room.js`: adaptador PeerJS con la misma interfaz que `room` (`join(name,{hub})` → `emit/on/presence/onPeers/leave`). Solo entra en la versión web.
- `src/styles.css`: estilos de ambas versiones (oscuro por defecto, estética de «expediente confidencial»).
- `src/template.html` (artefacto) y `web/template.html` (web): plantillas.
- `web/sw.js`, `web/manifest.webmanifest`, `web/icon-*.png`: PWA.
- `build.py`: genera `dist/impostor.html`, `dist/web/` y el zip.

## Comandos
```bash
python3 build.py                      # compilar las dos versiones
node test/rules.test.js               # lógica (reparto, modos, victoria, imágenes, aleatorio)
python3 test/ui_test.py shots         # interfaz de un solo móvil (Playwright, Chromium)
python3 test/jam_test.py shots        # sala de Claude simulada: anfitrión + 3 móviles
MODE=web python3 test/jam_test.py shots   # sala web (PeerJS simulado)
```
Las pruebas de interfaz necesitan `pip install playwright && playwright install chromium`.

- `python3 watch.py` recompila al cambiar algo en `src/` o `web/`.
- En Windows se usa `python` (el `python3` de Microsoft Store es un acceso directo vacío). `build.py` lee y escribe siempre en UTF-8 con LF.
- VS Code: `.vscode/tasks.json` tiene todas estas órdenes como tareas, además de «Servidor local» (`dist/web` en http://localhost:8000) y «Túnel HTTPS para el móvil» (`cloudflared tunnel --url`, sin cuenta). El túnel es necesario porque por `http://192.168.x.x` no hay `crypto.subtle` ni service worker, así que la sala no funciona.

## Decisiones tomadas
- Todo funciona sin cuenta y sin conexión en modo un solo móvil. Los datos son locales del dispositivo; hay copia de seguridad en Ajustes.
- **Votación en sala:** siempre secreta desde cada móvil. El anfitrión puede cerrarla antes de tiempo.
- **Imágenes como palabras:**
  - En el artefacto, si hay `assets` se suben; si no, se guarda una copia reducida (`data:`) en el móvil, que en sala de Claude no se puede usar.
  - En la web viajan cifradas dentro de la tarjeta.
- **Impostores aleatorios:** `randomImpostors` con rango `impMin`/`impMax` (0 = máximo posible), y `knowEachOther` configurable. Tras cada expulsión se dice si sigue la partida sin revelar cuántos quedan.
- **Inicio:** al pulsar «Jugar con un solo móvil» aparece primero la pantalla «¿Quién juega?», con los últimos nombres y los grupos guardados (`Store.groups`).
- **Sonidos:** sintetizados con Web Audio (sin archivos); se desactivan en Ajustes.

## URL del artefacto
`https://claude.ai/artifact/DiyBH86ezmKyiXWsB1nffh` (constante `ARTIFACT_URL` en `jam.js`; se usa para el enlace y el QR de la sala de Claude).
