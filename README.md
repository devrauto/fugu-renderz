# Fugu RenderZ — API y simulador local

API local que usa RenderZ como fuente de fichas y ejecuta en nuestro código el cálculo exacto de rango, entrenamiento, skills, 33 atributos y seis estadísticas resumidas. Usa un perfil BLTR exclusivo para sincronizar la tabla de entrenamiento de RenderZ.

## Preparación

Requiere Node.js 20 o posterior, o Bun, y BLTR con las APIs locales activas en `127.0.0.1:10108` y `127.0.0.1:51090`.

```bash
npm run browser:authorize
```

Con Bun: `bun run browser:authorize`.

## Autorizar

```bash
npm run browser:authorize
```

Con Bun: `bun run browser:authorize`.

Crea (solo si no existe) el perfil BLTR `fugu-renderz`, lo abre visible, espera hasta 15 minutos si se necesita intervención y verifica una búsqueda de `Neymar`. BLTR conserva las cookies y almacenamiento en el perfil; el proyecto solo guarda su UUID en `.cache/bltr-session.json`.

Para ampliar la espera, por ejemplo a 20 minutos:

```bash
RENDERZ_AUTH_TIMEOUT_MS=1200000 npm run browser:authorize
```

## Comprobar la sesión sin modificarla

```bash
npm run browser:test-session
```

Con Bun: `bun run browser:test-session`.

La comprobación consulta la pestaña y realiza la búsqueda sin reescribir el archivo de metadatos.

## Datos locales

El perfil real vive en BLTR. `.cache/` solo contiene el UUID y está excluido de Git.

En un servidor sin pantalla, usa Browser Preview, escritorio remoto o VNC con acceso local/protegido. No publiques un puerto de depuración de Chromium. El comando se detiene con instrucciones si detecta Linux sin `DISPLAY` ni `WAYLAND_DISPLAY`.

## Variables opcionales

`BLTR_API_URL`, `BLTR_BETA_AUTOMATION_URL`, `RENDERZ_URL` y `RENDERZ_AUTH_TIMEOUT_MS` permiten cambiar endpoints y espera.

## Arrancar la API

```bash
npm run api:start
```

BLTR solo es necesario para las rutas oráculo (`/api/build`, `/api/reviews`,
`/api/combined`) y para refrescar la tabla de entrenamiento; el resto funciona
con la caché local y consultas directas a RenderZ.

Ejemplo verificado de Maldini a rango oro, nivel 30 y la build recomendada por FCMobileForum:

```text
http://127.0.0.1:8787/api/combined/30919106?reviewId=1389&rank=5&training=30&skills=30021.2-39011.1-39013.1-39014.1
```

Rutas principales:

- `/api/max/:playerId`: simulación local a rango 5 y entrenamiento 30.
- `/api/simulate/:playerId?rank=0&training=30&skills=...`: cualquier build válida.
- `/api/player/:playerId`: ficha base completa de RenderZ, incluidos atributos y árbol de skills.
- `/api/players/search?positions=CB,RB&maxPrice=...`: catálogo vivo paginado por posición, OVR, precio y disponibilidad; `nextCursor` permite recorrerlo completo.
- `/api/model`: fórmulas y pesos del motor.
- `/api/model/positions/:position`: incrementos y acumulados de niveles 1–30 para una posición.
- `/api/build/:playerId`: cálculo en la propia interfaz de RenderZ, usado como oráculo de validación.
- `/api/reviews/:reviewId` y `/api/combined/:playerId?reviewId=...`: reseñas y cruce con FCMobileForum.
- `/api/squads/uid/:uid`: comprueba el estado de vinculación de un UID sin inventar su plantilla.
- `/api/squads/renderz/:squadId`: importa XI, suplentes, formación, rango, nivel y skills de un snapshot público.
- `/api/squads/renderz/:squadId/analyze?mode=h2h`: análisis separado para `h2h`, `vsa` o `manager`.
- `POST /api/squads/analyze`: analiza una plantilla enviada por JSON.
- `POST /api/squads/recommend`: compara fichajes, optimiza automáticamente sus skill points y ordena mejoras.
- `POST /api/squads/auto-recommend`: descubre candidatos actuales por sí solo, aplica presupuesto y decide los reemplazos.
- `/api/squads/renderz/:squadId/auto-recommend?mode=h2h&maxPrice=...`: importación y recomendación automática en una sola llamada.
- `/api/scoring/model`: expone el modelo heurístico versionado para auditoría.
- `/health`: estado del servicio.

Ejemplos:

```text
http://127.0.0.1:8787/api/max/30919106
http://127.0.0.1:8787/api/simulate/30919106?rank=0&training=30
http://127.0.0.1:8787/api/model/positions/CB
```

Para comparar el motor local con RenderZ en varias posiciones:

```bash
npm run test:model
npm run test:random
npm run test:squad
npm run test:screenshot
```

`test:random` renueva mediante BLTR la lista de jugadores reales, selecciona una
muestra aleatoria estratificada por posición y contrasta OVR, seis estadísticas
resumidas y todos los atributos detallados contra la interfaz de RenderZ. La
prueba es reproducible con `RANDOM_SEED=20260802 npm run test:random`.

Consulta [docs/ANALISIS-RANGO-ENTRENAMIENTO.md](docs/ANALISIS-RANGO-ENTRENAMIENTO.md) para las fórmulas exactas y la validación reproducible.

## Grok Bot (gestionado)

Repo privado: https://github.com/devrauto/fugu-renderz — el Bot lo clona a
`/workspace/fugu-renderz` y corre `scripts/install-on-bot.sh`. Prompt único:
[docs/GROK-BOT.md](docs/GROK-BOT.md).

## Servidor MCP para Cursor / Grok Build

El servidor MCP es autónomo: ejecuta el motor en proceso y no necesita la API
HTTP ni BLTR para las tools habituales. Si falta la tabla de entrenamiento,
usa `data/position-modifiers.json` o `.cache/` (BLTR solo si no hay ninguna).

| Cliente | Cómo conectarlo |
| --- | --- |
| **Grok Bot** | CLI en `/workspace` (arriba). No MCP. |
| Cursor local, AutoClaw, Grok Build | stdio: `.mcp.json` / `mcp-config.example.json` |

### stdio (Cursor / Grok Build / AutoClaw)

```bash
npm run mcp:start
```

Copia `mcp-config.example.json` en la configuración MCP de tu cliente, o deja
el `.mcp.json` del repo (Grok Build y Claude Code lo cargan solos).

Como plugin de Grok Build, desde la raíz del repo:

```bash
grok plugin marketplace add .
grok plugin install fugu-fcmobile --trust
```

El plugin incluye las tools MCP y la skill `fugu-fcmobile`.

### HTTP remoto (opcional)

Solo si hace falta un conector HTTPS (grok.com chat, API xAI), no para Grok Bot:

```bash
FUGU_MCP_TOKEN=$(openssl rand -hex 24) npm run mcp:http
```

`FUGU_FETCH_TIMEOUT_MS` (20000 por defecto) limita cada consulta a RenderZ.
Consulta [docs/PLAN-MCP.md](docs/PLAN-MCP.md) para la arquitectura y
la revisión de lógicas.

Publica las tools `resolve_fcm_uid`, `get_player`, `search_players`, `simulate_player`,
`import_renderz_squad`, `analyze_renderz_squad`, `analyze_squad`,
`recommend_changes`, `auto_recommend_changes`, `inspect_squad_screenshot`,
`analyze_squad_screenshot`, `get_scoring_model`, `import_club_cards`,
`get_club` y `analyze_club`. Las tres últimas mantienen el club persistente del
usuario en `data/club.json`: cartas observadas en capturas de la colección,
resueltas contra RenderZ y puntuadas en sus posiciones viables (rango actual y
a tope) para decidir ventas, fichajes y mejoras. Consulta
[docs/META-Y-ANALISIS-DE-PLANTILLAS.md](docs/META-Y-ANALISIS-DE-PLANTILLAS.md)
para el contrato, los criterios y sus límites.

Un UID de FC Mobile por sí solo no expone públicamente la plantilla. El flujo
seguro de RenderZ requiere iniciar sesión allí, generar un código de un solo uso
y ponerlo temporalmente como nombre de la plantilla activa. La API devuelve
`needs_verification` hasta completar ese paso; nunca deduce ni fabrica jugadores.

## Analizar desde una captura

La alternativa sin cuenta usa dos tools MCP. `inspect_squad_screenshot` acepta
`imagePath` o una imagen PNG/JPEG/WebP en base64 y la entrega como contenido
visual a la IA. Después `analyze_squad_screenshot` cruza sus observaciones con
RenderZ. Nombre, OVR, rango, entrenamiento y diseño/evento deben coincidir; si
dos cartas distintas siguen encajando, devuelve `needs_clarification`.

Los skill points no suelen estar visibles en la pantalla del XI. En ese caso el
resultado muestra la build optimizada que usaría el recomendador, sin afirmar
que sea la asignación actual de la cuenta.
