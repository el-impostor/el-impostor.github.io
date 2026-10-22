# El Impostor — notas del proyecto

Juego de deducción social en español de España. Dos formas de jugar:
- **Un solo móvil**: se pasa el teléfono para ver los papeles.
- **Sala**: cada jugador en su móvil, entrando por QR o enlace.

## Cómo trabajar en este proyecto
Estas normas se aplican siempre:
- **Textos de la interfaz** en español de España, con tono cercano y claro.
- **`rules.js` es lógica pura:** nada de DOM ni de almacenamiento. Todo cambio de reglas lleva su prueba en `test/rules.test.js`.
- **Después de cada cambio:** `python3 build.py` y todas las pruebas. Nada se da por terminado con pruebas fallando.
- **Hay dos versiones que no se pueden romper:**
  - `dist/impostor.html` (artefacto de Claude):
    - un único archivo;
    - scripts externos solo de cdnjs.cloudflare.com, unpkg.com o cdn.jsdelivr.net, y con versión exacta;
    - nada de `fetch` a otros dominios;
    - nada de `alert`, `confirm` ni `prompt`.
  - `dist/web` (PWA): debe seguir funcionando sin conexión en el modo de un solo móvil.
- **Móvil primero:** todo debe verse bien a 390 px de ancho, sin scroll horizontal, en tema oscuro y claro.
- **Datos guardados:** si cambia el formato de lo que se guarda en `localStorage`, hay que migrar los datos antiguos. Nadie debe perder sus palabras, grupos ni estadísticas.
- **Commits:** uno por cambio, con el mensaje en español. No hacer push ni publicar nada sin preguntar.
- **Cambios grandes:** enseñar antes un plan corto.

## Dos versiones que salen del mismo código
- `dist/impostor.html`: artefacto de Claude (claude.ai). La sala usa la capacidad `room` de Claude y solo admite gente con cuenta y acceso compartido. Las imágenes se suben con `assets`.
- `dist/web/`: versión web independiente (PWA instalable). La sala va por el servidor de salas de `server/` (Cloudflare Workers + Durable Objects) y no hace falta cuenta para jugar. Se publica en GitHub Pages con `.github/workflows/pages.yml`. `dist/el-impostor-web.zip` es esa carpeta comprimida.

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
- `src/relay-room.js`: adaptador del servidor de salas con la misma interfaz que `room` (`join(name,{hub,token})` → `emit/on/presence/onPeers/onStatus/leave`). Se reconecta solo y reenvía la presencia al volver. Solo entra en la versión web.
- `server/`: servidor de salas (Worker + Durable Object `Sala`, `server/src/index.js`). Reenvía mensajes sin entenderlos, guarda el último estado, solo deja ser anfitrión a quien tiene el token de la sala, admite 30 jugadores y borra la sala tras 12 h sin actividad (variables en `server/wrangler.toml`). Su dirección pública va en `server/relay-url.txt`. Solo acepta conexiones desde `https://el-impostor.github.io` (`ORIGENES`); las pruebas en local arrancan el servidor con `ORIGENES=*`.
- `src/styles.css`: estilos de ambas versiones (oscuro por defecto, estética de «expediente confidencial»).
- `src/template.html` (artefacto) y `web/template.html` (web): plantillas.
- `web/sw.js`, `web/manifest.webmanifest`, `web/icon-*.png`: PWA. `web/vendor/qrcode.min.js` (qrcodejs 1.0.0) va dentro de `dist/web` y lo guarda el service worker.
- `build.py`: genera `dist/impostor.html`, `dist/web/` y el zip.

## Comandos
```bash
python3 build.py                      # compilar las dos versiones
node test/rules.test.js               # lógica (reparto, modos, victoria, imágenes, aleatorio)
python3 test/ui_test.py shots         # interfaz de un solo móvil (Playwright, Chromium)
python3 test/jam_test.py shots        # sala de Claude simulada: anfitrión + 3 móviles
MODE=web python3 test/jam_test.py shots   # sala web contra el servidor de salas real (wrangler dev en local)
node test/server.test.mjs             # servidor de salas
node test/relay-dev.mjs 8787          # servidor de salas en local para probar a mano
```
- Las pruebas de interfaz necesitan `pip install playwright && playwright install chromium`.
- Las del servidor y la sala web necesitan `npm install` en `server/` (instala wrangler). No hace falta cuenta de Cloudflare.
- Probar la sala a mano: tarea «Probar sala en local» y abrir varias ventanas en `http://localhost:8000/?sala-servidor=ws://127.0.0.1:8787` (`?sala-servidor=` solo acepta servidores locales).
- Publicar el servidor: `cd server && npx wrangler deploy`; poner la dirección `wss://…workers.dev` en `server/relay-url.txt` y volver a compilar.

- `python3 watch.py` recompila al cambiar algo en `src/` o `web/`.
- En Windows se usa `python` (el `python3` de Microsoft Store es un acceso directo vacío). `build.py` lee y escribe siempre en UTF-8 con LF.
- VS Code: `.vscode/tasks.json` tiene todas estas órdenes como tareas, además de «Servidor local» (`dist/web` en http://localhost:8000) y «Túnel HTTPS para el móvil» (`cloudflared tunnel --url`, sin cuenta). El túnel es necesario porque por `http://192.168.x.x` no hay `crypto.subtle` ni service worker, así que la sala no funciona.

## Decisiones tomadas
- Todo funciona sin cuenta y sin conexión en modo un solo móvil. Los datos son locales del dispositivo; hay copia de seguridad en Ajustes.
- **Votación en sala:** siempre secreta desde cada móvil. El anfitrión puede cerrarla antes de tiempo.
- **Sala web con servidor propio** (Cloudflare Workers + Durable Objects, gratis para grupos de amigos) en vez de PeerJS: funciona con datos móviles y en redes con cortafuegos, y el servidor guarda el estado si el anfitrión se va un rato.
- **Cifrado de extremo a extremo en la web:** además de tarjetas y votos, el estado público, las pistas y el intento de adivinar van cifrados con una clave de sala que el anfitrión reparte a cada jugador (tema `rk`). El servidor solo ve nombres y bloques cifrados. Límite conocido: el móvil del jugador se fía de la clave pública del anfitrión que le llega; no se comprueba aparte.
- **Aportaciones en la sala (solo web):** si el anfitrión lo activa, cada jugador aporta hasta 20 palabras o fotos y pulsa «Listo». Van cifradas solo al anfitrión (`room.send`, tema `ap`, por trozos) y se reenvían hasta que el estado las confirma (`apk`). El anfitrión solo ve «Listo»/«Aún no», nunca el contenido, y puede repartir cuando quiera. Se juegan mezcladas con las categorías o solas (`R.contribCategory`, categoría `sala-aportadas`). El autor puede salir de impostor. Se guardan solo en memoria del anfitrión y se olvidan al cerrar la sala.
- **Claves de turno y voto** llevan el id de la partida (`gid.ronda.…`), para que no cuente nada de la partida anterior.
- **Lo nuevo de la sala web solo se activa con `STANDALONE`:** el artefacto de Claude se comporta igual que antes.
- **Imágenes como palabras:**
  - En el artefacto, si hay `assets` se suben; si no, se guarda una copia reducida (`data:`) en el móvil, que en sala de Claude no se puede usar.
  - En la web viajan cifradas dentro de la tarjeta.
- **Impostores aleatorios:** `randomImpostors` con rango `impMin`/`impMax` (0 = máximo posible), y `knowEachOther` configurable. Tras cada expulsión se dice si sigue la partida sin revelar cuántos quedan.
- **Inicio:** al pulsar «Jugar con un solo móvil» aparece primero la pantalla «¿Quién juega?», con los últimos nombres y los grupos guardados (`Store.groups`).
- **Sonidos:** sintetizados con Web Audio (sin archivos); se desactivan en Ajustes.

- **Monetización (de momento):** botón «Invítame a un café» solo en la web, que aparece si `web/donar-url.txt` (o `DONAR_URL`) tiene un enlace `https://`. El servidor cuenta por día salas, partidas y papeles repartidos (Durable Object `Contador`, sin nombres, palabras ni cookies); se ven en `https://impostor-salas.impostor-salas.workers.dev/estadisticas`.

## Dónde está publicado
- Web: https://el-impostor.github.io (repositorio `el-impostor/el-impostor.github.io`, organización de GitHub; se publica sola en cada push a `main`).
- Servidor de salas: `wss://impostor-salas.impostor-salas.workers.dev` (Cloudflare, `npx wrangler deploy` desde `server/`).

## URL del artefacto
`https://claude.ai/artifact/DiyBH86ezmKyiXWsB1nffh` (constante `ARTIFACT_URL` en `jam.js`; se usa para el enlace y el QR de la sala de Claude).
