# Publicar la versión web

Todo es gratis para grupos de amigos. Hacen falta dos cuentas:
- **Cloudflare**, para el servidor de salas;
- **GitHub**, para la web.

## 1. Servidor de salas (Cloudflare)
Una sola vez, desde la carpeta del proyecto:

```bash
cd server
npm install
npx wrangler login
npx wrangler deploy
```

- `wrangler login` abre el navegador: entra con tu cuenta de Cloudflare y pulsa **Allow**.
- La primera vez, `deploy` te pide elegir un subdominio de `workers.dev`, por ejemplo `tunombre`.
- Al terminar muestra la dirección: `https://impostor-salas.tunombre.workers.dev`.

Guarda esa dirección **cambiando `https` por `wss`** en `server/relay-url.txt`:

```
wss://impostor-salas.tunombre.workers.dev
```

Después: `python build.py`, todas las pruebas y commit.

## 2. Web (GitHub Pages)
1. En github.com: **New repository**, por ejemplo `el-impostor`.
   - **Público**: Pages gratis solo funciona con repositorios públicos en cuentas gratuitas. El código se verá, pero no hay claves secretas en él.
   - Sin README ni .gitignore: el proyecto ya los tiene.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Subir el proyecto (Claude lo hace solo si se lo pides):
   ```bash
   git remote add origin https://github.com/TUUSUARIO/el-impostor.git
   git push -u origin main
   ```
   La primera vez Git abre el navegador para entrar en GitHub.
4. En la pestaña **Actions** se ve «Publicar en GitHub Pages». Al terminar, la web está en `https://TUUSUARIO.github.io/el-impostor/`.

Cada `git push` a `main` vuelve a compilar y publicar la web. El servidor no se actualiza solo: si cambia `server/`, hay que volver a ejecutar `npx wrangler deploy`.

## 3. Que solo tu web use el servidor (recomendado)
En `server/wrangler.toml`:

```toml
ORIGENES = "https://TUUSUARIO.github.io"
```

y otra vez `npx wrangler deploy` desde `server/`.

## Límites gratuitos
- Unas 28 horas de sala abierta al día en total, y 100.000 peticiones al día.
- Si se superan, las salas fallan hasta las 00:00 UTC; no se cobra nada.
- La sala se borra sola tras 12 h sin actividad o cuando el anfitrión la cierra.

---

# Prueba real con amigos

Antes de empezar:
- Todos abren la URL de GitHub Pages (https).
- Al menos uno la instala: «Añadir a pantalla de inicio».

**Preparación**
- [ ] El anfitrión crea la sala y se ve el QR.
- [ ] Uno entra escaneando el QR y otro escribiendo el código a mano.
- [ ] El anfitrión ve a todos en la lista con su nombre.

**Redes y móviles**
- [ ] Varios en la **misma wifi** entran y reciben su papel.
- [ ] Uno con **datos móviles** (wifi apagada) entra y recibe su papel.
- [ ] **iPhone (Safari)**: entra, ve su papel, vota, y la pantalla no se apaga sola en mitad de la partida.
- [ ] **Android (Chrome)**: lo mismo.

**Desconexiones**
- [ ] El anfitrión **bloquea el móvil 30 segundos** durante las pistas:
  - los jugadores ven «El anfitrión se ha desconectado»;
  - al desbloquear, el aviso desaparece en unos segundos;
  - la partida sigue en el mismo turno.
- [ ] Un jugador cierra la app y la vuelve a abrir: vuelve a la sala, recupera su papel y el anfitrión ve «X ha vuelto».
- [ ] Un jugador pone **modo avión**, vota y lo quita: el voto cuenta.
- [ ] Alguien entra con la partida empezada: ve «Partida en curso» y juega la siguiente.

**Partida completa**
- [ ] Pistas, debate, votación secreta, resultado y final en todos los móviles.
- [ ] «Otra partida con la misma sala» funciona sin que nadie vuelva a entrar.
- [ ] Al cerrar la sala, los jugadores ven «El anfitrión ha cerrado la sala».

**Sin conexión**
- [ ] Con la app instalada y en modo avión, el modo de un solo móvil funciona entero.

Apunta qué falla, en qué móvil y en qué paso: con eso basta para arreglarlo.
