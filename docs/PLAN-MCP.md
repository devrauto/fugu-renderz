# Plan: MCP potente y revisión de lógicas

Fecha: 2 de agosto de 2026. Estado: implementado.

## Objetivo

Convertir `scripts/mcp-server.js` en un servidor MCP autónomo y robusto: sin
dependencia obligatoria de la API HTTP ni de BLTR para las tools habituales,
con el protocolo MCP bien negociado y errores accionables.

## Arquitectura

```
                    ┌──────────────────────┐
 stdio (MCP) ──────►│                      │
 Streamable HTTP ──►│  scripts/mcp-server  │──┐
                    └──────────────────────┘  │   ┌──────────────────────────┐
                    ┌──────────────────────┐  ├──►│  scripts/fugu-service.js │
 HTTP :8787 ───────►│  scripts/api-server  │──┘   │  caché jugadores          │
                    └──────────────────────┘      │  modificadores (disco →   │
                                                  │  BLTR sólo si faltan)     │
                                                  └──────────┬───────────────┘
                                                             │
                                    renderz-model.js  renderz-search.js  squad-analysis.js
```

- `fugu-service.js` es la capa compartida: caché de fichas base, carga de la
  tabla de entrenamiento (disco → navegador BLTR sólo como último recurso) y
  el cableado de dependencias (`getPlayer`, `simulate`, `searchPlayers`).
- El MCP ejecuta el motor en proceso. La API HTTP queda para uso humano y para
  las rutas oráculo que sí exigen navegador (`/api/build`, `/api/reviews`,
  `/api/combined`).
- BLTR sólo es imprescindible para refrescar `position-modifiers.json` (la
  tabla vive en `.cache/`) y para las rutas oráculo.

## Revisión de lógicas: hallazgos y decisiones

1. **`api-server.js` exigía BLTR en todas las rutas** (`health()` +
   `loadSession()` + `getTarget()` al inicio de cada petición), aunque la
   mayoría de endpoints sólo usan `fetch` directo. Corregido: BLTR se resuelve
   de forma perezosa y únicamente en rutas de navegador o refresh del modelo.
2. **`renderz-search.js` interpolaba `text` sin escapar dentro de un
   `query_string` de Elasticsearch**: nombres con `:`, `/`, comillas u
   operadores (`AND`, `-`) rompían la consulta o alteraban su semántica.
   Corregido con escape de caracteres reservados.
3. **`mcp-server.js` aceptaba cualquier `protocolVersion`** devolviéndolo tal
   cual; ahora negocia contra la lista soportada (2024-11-05 → 2025-06-18) y
   responde con la más reciente soportada si la del cliente no se reconoce.
4. **Tool desconocida devolvía `isError` en vez de error JSON-RPC** (-32602
   según la spec para nombre inválido). Corregido; los fallos de ejecución
   siguen siendo `isError: true` con mensaje accionable.
5. **Sin timeouts aguas arriba**: un RenderZ colgado bloqueaba la tool
   indefinidamente. Ahora cada `fetch` usa `AbortSignal.timeout` y el error
   distingue "RenderZ no responde" de "la carta no existe".
6. **Fetch directo verificado el 2026-08-02**: la ficha de jugador y la
   búsqueda funcionan sin navegador; `/api/player/upgrade` devuelve 404 fuera
   del navegador, así que el refresh de la tabla mantiene el camino BLTR.
7. Lógicas revisadas y correctas (sin cambio): filtro `auctionable` invertido
   de la búsqueda (false = no filtrar, necesario para cartas no subastables de
   plantillas), poda de `optimizePlayerBuild` (≤5 puntos de rango acota la
   explosión combinatoria), elección del titular más débil por hueco en
   `recommendChanges`, y el umbral de ambigüedad de `resolveScreenshotSquad`
   (variantes equivalentes por huella de PlayStyles).

## Contrato MCP

- Tools sin cambios de nombre ni esquema de entrada (compatibles con clientes
  existentes): `resolve_fcm_uid`, `get_player`, `search_players`,
  `simulate_player`, `import_renderz_squad`, `analyze_renderz_squad`,
  `analyze_squad`, `recommend_changes`, `auto_recommend_changes`,
  `inspect_squad_screenshot`, `analyze_squad_screenshot`, `get_scoring_model`.
- Todas declaran `annotations` (`readOnlyHint: true`, `openWorldHint: true` en
  las que consultan RenderZ) y `title` legible.
- `initialize` publica `instructions` con el flujo recomendado (buscar →
  simular → analizar → recomendar; captura → inspect → analyze).
- El transporte es stdio (JSON por líneas) o Streamable HTTP (`--http` / `npm run mcp:http`):
  un endpoint `POST /mcp` que responde JSON, sin SSE. Grok Bot, grok.com y la
  API xAI solo hablan HTTP(S) público; stdio y `localhost` no les llegan.
  `structuredContent` acompaña siempre al bloque de texto.
- El repo se puede instalar como plugin de Grok Build (`plugin.json`, `.mcp.json`,
  skill `fugu-fcmobile`). Eso no sustituye el conector HTTP en Grok Bot.

## Verificación

- `node --check` sobre todos los scripts.
- Sesión JSON-RPC real por stdio: `initialize`, `tools/list`,
  `get_scoring_model`, `search_players`, `simulate_player`,
  `analyze_squad` e `inspect_squad_screenshot` (imagen sintética).
- Handshake Streamable HTTP (`npm run test:mcp-http`): `GET /mcp`, `initialize`
  con Bearer, `notifications/initialized` → 202, `tools/list`, `resources/list`,
  `prompts/list`, `ping` y rechazo de origen extraño.
- La API HTTP arranca sin BLTR y sirve las rutas sin navegador; las rutas
  oráculo siguen exigiéndolo.
