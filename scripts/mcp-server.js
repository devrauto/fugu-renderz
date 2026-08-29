import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import fs from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { engineDependencies, getBasePlayer, importRenderzSquad, loadPositionModifiers, searchPlayers } from "./fugu-service.js";
import { parseSkills, simulatePlayer } from "./renderz-model.js";
import { analyzeSquad, autoRecommendChanges, recommendChanges, resolveScreenshotSquad, scoringModel, uidResolution } from "./squad-analysis.js";
import { analyzeClub, loadClub, resolveOwnedCard, saveClub, upsertClubPlayers } from "./club-roster.js";

const SERVER = { name: "fugu-fcmobile", title: "Fugu FC Mobile (RenderZ)", version: "2.1.0" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = [
  "Servidor autónomo de análisis FC Mobile sobre el catálogo vivo de RenderZ; no necesita la API HTTP local.",
  "Flujo de mercado: search_players (cursor para paginar) → simulate_player o get_player → analyze_squad → recommend_changes / auto_recommend_changes.",
  "Flujo de captura: inspect_squad_screenshot acepta imageBase64 (preferido en Grok Bot y conectores remotos) o imagePath local; transcribe sólo lo visible y pásalo a analyze_squad_screenshot, que valida contra RenderZ y responde needs_clarification ante ambigüedad.",
  "Un UID de FC Mobile no expone la plantilla: resolve_fcm_uid explica el flujo de verificación y nunca se inventan jugadores."
].join(" ");
const MCP_PATHS = new Set(["/", "/mcp", "/.well-known/mcp/server-card.json"]);

const readOnly = { readOnlyHint: true, openWorldHint: true };
const localOnly = { readOnlyHint: true, openWorldHint: false };

const tools = [
  {
    name: "inspect_squad_screenshot",
    title: "Inspeccionar captura de plantilla",
    annotations: { ...localOnly, title: "Inspeccionar captura de plantilla" },
    description: "Carga una captura PNG/JPEG/WebP y la devuelve como contenido visual MCP para que la IA lea formación, nombres, OVR, rango y entrenamiento antes de resolver las cartas. En Grok Bot y MCP remoto usa imageBase64; imagePath solo sirve si el archivo está en la máquina donde corre este servidor.",
    inputSchema: { type: "object", properties: {
      imagePath: { type: "string", description: "Ruta local absoluta en el servidor MCP. No es accesible desde Grok Bot." },
      imageBase64: { type: "string", description: "Imagen en base64 puro, sin prefijo data:. Obligatorio para clientes remotos (Grok Bot, grok.com)." }
    }, additionalProperties: false }
  },
  {
    name: "resolve_fcm_uid",
    title: "Resolver UID de FC Mobile",
    annotations: { ...localOnly, title: "Resolver UID de FC Mobile" },
    description: "Comprueba si un UID de FC Mobile puede resolverse de forma autorizada y devuelve los siguientes métodos de importación sin inventar una plantilla.",
    inputSchema: { type: "object", properties: { uid: { type: "string", pattern: "^[0-9]{15,22}$" } }, required: ["uid"], additionalProperties: false }
  },
  {
    name: "get_player",
    title: "Ficha completa de una carta",
    annotations: { ...readOnly, title: "Ficha completa de una carta" },
    description: "Obtiene la ficha observada completa de una carta de RenderZ, incluidos atributos, posiciones, traits, skills y PlayStyles.",
    inputSchema: { type: "object", properties: { renderzId: { type: "string", pattern: "^[0-9]+$" } }, required: ["renderzId"], additionalProperties: false }
  },
  {
    name: "search_players",
    title: "Buscar en el catálogo vivo",
    annotations: { ...readOnly, title: "Buscar en el catálogo vivo" },
    description: "Busca el catálogo actual de RenderZ por posición, OVR, disponibilidad y precio. Devuelve un cursor para recorrer todas las páginas sin depender de IDs conocidos.",
    inputSchema: { type: "object", properties: {
      text: { type: "string", minLength: 1, maxLength: 100 }, positions: { type: "array", items: { type: "string" } }, limit: { type: "integer", minimum: 1, maximum: 40 },
      rank: { type: "integer", minimum: 0, maximum: 5 }, minOvr: { type: "integer" }, maxOvr: { type: "integer" },
      maxPrice: { type: "number", minimum: 1 }, auctionable: { type: "boolean" },
      sort: { type: "string", enum: ["rating", "price", "added"] }, cursor: { type: "string" }
    }, additionalProperties: false }
  },
  {
    name: "simulate_player",
    title: "Simular build exacta",
    annotations: { ...readOnly, title: "Simular build exacta" },
    description: "Calcula exactamente una build de jugador con rango, entrenamiento y skills usando el modelo validado contra RenderZ.",
    inputSchema: {
      type: "object", properties: {
        renderzId: { type: "string", pattern: "^[0-9]+$" }, rank: { type: "integer", minimum: 0, maximum: 5 },
        training: { type: "integer", minimum: 0, maximum: 30 }, skills: { type: "string", description: "Ejemplo: 30021.2-39011.1" }
      }, required: ["renderzId"], additionalProperties: false
    }
  },
  {
    name: "analyze_squad",
    title: "Analizar plantilla manual",
    annotations: { ...readOnly, title: "Analizar plantilla manual" },
    description: "Analiza una plantilla para H2H, VSA o Manager y devuelve encaje por posición, fortalezas, debilidades, riesgos y evidencias explicables.",
    inputSchema: {
      type: "object", properties: {
        mode: { type: "string", enum: ["h2h", "vsa", "manager"] }, formation: { type: "string" },
        techniqueProfile: { type: "string", enum: ["balanced", "possession", "counter", "wing_cross", "skill_dribble", "direct"] },
        source: { type: "object" },
        players: { type: "array", minItems: 1, maxItems: 18, items: { type: "object", properties: {
          renderzId: { type: "string", pattern: "^[0-9]+$" }, slot: { type: "string" }, rank: { type: "integer", minimum: 0, maximum: 5 },
          training: { type: "integer", minimum: 0, maximum: 30 }, skills: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, level: { type: "integer" } }, required: ["id", "level"] } }
        }, required: ["renderzId", "slot"] } }
      }, required: ["mode", "players"], additionalProperties: false
    }
  },
  {
    name: "get_scoring_model",
    title: "Modelo de puntuación auditable",
    annotations: { ...localOnly, title: "Modelo de puntuación auditable" },
    description: "Devuelve la versión, perfiles de rol y reglas PlayStyle usadas por el recomendador para auditar sus criterios.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "import_renderz_squad",
    title: "Importar plantilla RenderZ",
    annotations: { ...readOnly, title: "Importar plantilla RenderZ" },
    description: "Importa un snapshot público de Squadbuilder/plantilla vinculada de RenderZ con XI, banquillo, rangos, entrenamiento, skills y PlayStyles.",
    inputSchema: { type: "object", properties: { squadId: { type: "string", pattern: "^[A-Za-z0-9_-]{10,64}$" } }, required: ["squadId"], additionalProperties: false }
  },
  {
    name: "analyze_renderz_squad",
    title: "Importar y analizar XI titular",
    annotations: { ...readOnly, title: "Importar y analizar XI titular" },
    description: "Importa y analiza directamente el XI titular de un snapshot público RenderZ para H2H, VSA o Manager.",
    inputSchema: { type: "object", properties: { squadId: { type: "string", pattern: "^[A-Za-z0-9_-]{10,64}$" }, mode: { type: "string", enum: ["h2h", "vsa", "manager"] } }, required: ["squadId", "mode"], additionalProperties: false }
  },
  {
    name: "recommend_changes",
    title: "Comparar fichajes concretos",
    annotations: { ...readOnly, title: "Comparar fichajes concretos" },
    description: "Compara una plantilla contra cartas candidatas reales, recalcula su encaje por modo y ordena reemplazos con delta, razones y tradeoffs.",
    inputSchema: { type: "object", properties: {
      squad: { type: "object" }, candidates: { type: "array", minItems: 1, items: { type: "object", properties: {
        renderzId: { type: "string", pattern: "^[0-9]+$" }, rank: { type: "integer", minimum: 0, maximum: 5 }, training: { type: "integer", minimum: 0, maximum: 30 },
        skills: { type: "array" }, slots: { type: "array", items: { type: "string" } }
      }, required: ["renderzId"] } }, limit: { type: "integer", minimum: 1, maximum: 50 }
    }, required: ["squad", "candidates"], additionalProperties: false }
  },
  {
    name: "auto_recommend_changes",
    title: "Fichajes automáticos del mercado",
    annotations: { ...readOnly, title: "Fichajes automáticos del mercado" },
    description: "Busca por sí sola en el mercado actual de RenderZ candidatos para los puestos más débiles, aplica presupuesto, optimiza skills y devuelve qué fichar y a quién sustituir.",
    inputSchema: { type: "object", properties: {
      squad: { type: "object" },
      market: { type: "object", properties: {
        maxPrice: { type: "number", minimum: 1 }, auctionable: { type: "boolean" },
        maxSlots: { type: "integer", minimum: 1, maximum: 11 }, maxCandidatesPerSlot: { type: "integer", minimum: 1, maximum: 40 },
        rank: { type: "integer", minimum: 0, maximum: 5 }, training: { type: "integer", minimum: 0, maximum: 30 },
        slots: { type: "array", items: { type: "string" } }, sort: { type: "string", enum: ["rating", "price", "added"] }
      }, additionalProperties: false },
      limit: { type: "integer", minimum: 1, maximum: 50 }
    }, required: ["squad"], additionalProperties: false }
  },
  {
    name: "import_club_cards",
    title: "Importar cartas al club",
    annotations: { ...readOnly, title: "Importar cartas al club" },
    description: "Resuelve contra RenderZ cartas observadas en la colección del usuario (nombre, OVR, posición natural) y las guarda en el club persistente (data/club.json). Devuelve las ambiguas con candidatos en vez de adivinar.",
    inputSchema: { type: "object", properties: {
      observations: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", properties: {
        name: { type: "string", minLength: 1 }, displayedOvr: { type: "integer" },
        naturalPosition: { type: "string", description: "Posición natural mostrada en la carta; admite etiquetas en español (EI, MCD, DFC...)." },
        training: { type: "integer", minimum: 0, maximum: 30 }, rank: { type: "integer", minimum: 0, maximum: 5 },
        variant: { type: "string" }, locked: { type: "boolean", description: "Candado visible: la carta no se puede vender." },
        duplicate: { type: "boolean", description: "Marca copias repetidas de la misma carta." }
      }, required: ["name", "displayedOvr", "naturalPosition"], additionalProperties: false } },
      replace: { type: "boolean", description: "Si es true, vacía el club antes de importar." }
    }, required: ["observations"], additionalProperties: false }
  },
  {
    name: "get_club",
    title: "Ver club guardado",
    annotations: { ...localOnly, title: "Ver club guardado" },
    description: "Devuelve la plantilla persistente del usuario tal como está guardada, sin recalcular nada.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "analyze_club",
    title: "Analizar club completo",
    annotations: { ...readOnly, title: "Analizar club completo" },
    description: "Puntúa cada carta del club en sus posiciones viables (actual y a tope), calcula la profundidad por puesto y lista prescindibles y duplicados para vender.",
    inputSchema: { type: "object", properties: {
      mode: { type: "string", enum: ["h2h", "vsa", "manager"] }
    }, additionalProperties: false }
  },
  {
    name: "analyze_squad_screenshot",
    title: "Resolver y analizar captura",
    annotations: { ...readOnly, title: "Resolver y analizar captura" },
    description: "Resuelve contra RenderZ los jugadores que la IA ha leído de una captura, rechaza ambigüedades y devuelve análisis más fichajes automáticos. La IA debe inspeccionar la imagen y rellenar observations, no adivinar campos ilegibles.",
    inputSchema: { type: "object", properties: {
      mode: { type: "string", enum: ["h2h", "vsa", "manager"] }, formation: { type: "string" }, captureHash: { type: "string" },
      observations: { type: "array", minItems: 1, maxItems: 18, items: { type: "object", properties: {
        slot: { type: "string" }, name: { type: "string" }, displayedOvr: { type: "integer" },
        rank: { type: "integer", minimum: 0, maximum: 5 }, training: { type: "integer", minimum: 0, maximum: 30 },
        naturalPosition: { type: "string" }, program: { type: "string" }, variant: { type: "string", description: "Diseño/evento visible, por ejemplo UTOTS, TOTS o TWG." }
      }, required: ["slot", "name", "displayedOvr", "training"], additionalProperties: false } },
      market: { type: "object" }, recommendations: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 50 }
    }, required: ["mode", "observations"], additionalProperties: false }
  }
];

function detectImageMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new Error("La captura debe ser PNG, JPEG o WebP válido.");
}

async function inspectScreenshot(args) {
  if (!args.imagePath && !args.imageBase64) throw new Error("Indica imagePath o imageBase64.");
  if (args.imagePath && args.imageBase64) throw new Error("Indica imagePath o imageBase64, pero no ambos.");
  const buffer = args.imagePath ? await fs.readFile(args.imagePath) : Buffer.from(args.imageBase64, "base64");
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error("La captura debe ocupar entre 1 byte y 12 MB.");
  const mimeType = detectImageMime(buffer);
  const captureHash = createHash("sha256").update(buffer).digest("hex");
  return {
    __mcpImage: { data: buffer.toString("base64"), mimeType },
    structured: {
      status: "ready_for_visual_extraction", captureHash, mimeType, bytes: buffer.length,
      instructions: [
        "Lee únicamente texto y distintivos visibles; no completes nombres por intuición.",
        "Identifica la formación y cada puesto del XI, nombre mostrado, OVR, nivel de entrenamiento, color/nivel de rango y diseño/evento de la carta.",
        "Convierte el rango a 0-5 sólo si el color o distintivo es inequívoco.",
        "Llama después a analyze_squad_screenshot con estas observaciones y el captureHash."
      ],
      requiredObservationFields: ["slot", "name", "displayedOvr", "training"],
      optionalObservationFields: ["rank", "naturalPosition", "program", "variant"]
    }
  };
}

async function engine(refreshPlayers = false) {
  return engineDependencies(await loadPositionModifiers(), { refreshPlayers });
}

const handlers = {
  inspect_squad_screenshot: inspectScreenshot,
  resolve_fcm_uid: args => uidResolution(args.uid),
  get_player: async args => ({ source: "renderz", player: await getBasePlayer(args.renderzId) }),
  search_players: args => searchPlayers(args),
  simulate_player: async args => {
    const [player, modifiers] = await Promise.all([getBasePlayer(args.renderzId), loadPositionModifiers()]);
    return simulatePlayer(player, modifiers, { rank: args.rank ?? 5, training: args.training ?? 30, skills: parseSkills(args.skills || "") });
  },
  analyze_squad: async args => analyzeSquad(args, await engine(args.refreshPlayers === true)),
  get_scoring_model: () => scoringModel(),
  import_renderz_squad: args => importRenderzSquad(args.squadId),
  analyze_renderz_squad: async args => {
    const snapshot = await importRenderzSquad(args.squadId);
    const starters = snapshot.players.filter(player => player.starter);
    const analysis = await analyzeSquad(
      { source: snapshot.source, formation: snapshot.formation.name, mode: args.mode, players: starters },
      await engine()
    );
    return { snapshot: { squadId: snapshot.squadId, username: snapshot.username, rating: snapshot.rating }, analysis };
  },
  recommend_changes: async args => recommendChanges(args, await engine()),
  auto_recommend_changes: async args => autoRecommendChanges(args, await engine()),
  analyze_squad_screenshot: async args => resolveScreenshotSquad(args, await engine()),
  import_club_cards: async args => {
    const dependencies = await engine();
    const club = args.replace ? { players: [], updatedAt: null } : await loadClub();
    const resolved = [];
    const pending = [];
    for (const observation of args.observations) {
      const result = await resolveOwnedCard(observation, dependencies);
      if (result.status === "resolved") resolved.push({ ...result.entry, duplicate: observation.duplicate });
      else pending.push(result);
    }
    upsertClubPlayers(club, resolved, new Date().toISOString());
    await saveClub(club);
    return {
      status: pending.length ? "partially_imported" : "imported",
      imported: resolved.length, needsClarification: pending,
      clubSize: club.players.length
    };
  },
  get_club: () => loadClub(),
  analyze_club: async args => analyzeClub(await loadClub(), await engine(), { mode: args.mode || "h2h" })
};

function rpc(id, payload) {
  if (id === undefined) return null;
  return { jsonrpc: "2.0", id, ...payload };
}

export async function runTool(name, args = {}) {
  const reply = await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  if (reply?.error) throw new Error(reply.error.message);
  if (reply?.result?.isError) throw new Error(reply.result.content?.[0]?.text || "La tool falló.");
  return reply.result.structuredContent ?? reply.result;
}

export async function handle(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Petición JSON-RPC inválida." } };
  }
  const { id, method, params = {} } = message;
  if (typeof method !== "string") return rpc(id, { error: { code: -32600, message: "Petición JSON-RPC inválida." } });
  if (method === "initialize") {
    const requested = params.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
    return rpc(id, { result: {
      protocolVersion,
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
      serverInfo: SERVER,
      instructions: INSTRUCTIONS
    } });
  }
  if (method.startsWith("notifications/") || method === "initialized") return null;
  if (method === "ping" || method === "logging/setLevel") return rpc(id, { result: {} });
  if (method === "tools/list") return rpc(id, { result: { tools } });
  if (method === "prompts/list") return rpc(id, { result: { prompts: [] } });
  if (method === "resources/list") return rpc(id, { result: { resources: [] } });
  if (method === "resources/templates/list") return rpc(id, { result: { resourceTemplates: [] } });
  if (method === "tools/call") {
    const handler = handlers[params.name];
    if (!handler) return rpc(id, { error: { code: -32602, message: `Tool desconocida: ${params.name}` } });
    try {
      const value = await handler(params.arguments || {});
      if (value?.__mcpImage) {
        return rpc(id, { result: {
          content: [
            { type: "text", text: JSON.stringify(value.structured, null, 2) },
            { type: "image", data: value.__mcpImage.data, mimeType: value.__mcpImage.mimeType }
          ],
          structuredContent: value.structured
        } });
      }
      return rpc(id, { result: { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value } });
    } catch (error) {
      return rpc(id, { result: { isError: true, content: [{ type: "text", text: error.message }] } });
    }
  }
  return rpc(id, { error: { code: -32601, message: `Método no soportado: ${method}` } });
}

function send(message) {
  if (message) process.stdout.write(`${JSON.stringify(message)}\n`);
}

function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function originAllowed(origin) {
  if (!origin) return true;
  const extra = (process.env.FUGU_MCP_ORIGINS || "").split(",").map(item => item.trim()).filter(Boolean);
  if (extra.includes("*") || extra.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1"
      || hostname.endsWith(".grok.com") || hostname === "grok.com"
      || hostname.endsWith(".x.ai") || hostname === "x.ai"
      || hostname.endsWith(".cursor.com") || hostname === "cursor.com"
      || hostname.endsWith(".cursor.sh");
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const allow = origin && originAllowed(origin) ? origin : "*";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
    "access-control-expose-headers": "Mcp-Session-Id, MCP-Protocol-Version"
  };
}

function readBody(request, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Cuerpo demasiado grande."), { code: "PAYLOAD" }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function jsonResponse(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "mcp-protocol-version": SUPPORTED_PROTOCOLS[0],
    ...extraHeaders,
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function serverCard() {
  return {
    name: SERVER.name,
    title: SERVER.title,
    version: SERVER.version,
    protocolVersion: SUPPORTED_PROTOCOLS[0],
    transport: { type: "streamable-http", sse: false },
    capabilities: { tools: true },
    instructions: INSTRUCTIONS
  };
}

function authorize(request, token) {
  if (!token) return true;
  const header = request.headers.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return tokenMatches(provided, token);
}

async function handleHttp(request, response, token) {
  const origin = request.headers.origin;
  const headers = corsHeaders(origin);
  if (origin && !originAllowed(origin)) {
    jsonResponse(response, 403, { error: "Origen no permitido." }, headers);
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (!MCP_PATHS.has(url.pathname)) {
    jsonResponse(response, 404, { error: "Ruta desconocida. Usa POST /mcp." }, headers);
    return;
  }
  if (request.method === "GET") {
    const accept = String(request.headers.accept || "");
    if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
      response.writeHead(405, { allow: "POST, OPTIONS", ...headers });
      response.end();
      return;
    }
    jsonResponse(response, 200, serverCard(), headers);
    return;
  }
  if (request.method === "DELETE") {
    response.writeHead(405, { allow: "GET, POST, OPTIONS", ...headers });
    response.end();
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "GET, POST, OPTIONS", ...headers });
    response.end();
    return;
  }
  if (!authorize(request, token)) {
    jsonResponse(response, 401, { error: "Authorization Bearer requerido." }, headers);
    return;
  }
  let body;
  try { body = await readBody(request); }
  catch (error) {
    jsonResponse(response, error.code === "PAYLOAD" ? 413 : 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } }, headers);
    return;
  }
  let message;
  try { message = JSON.parse(body.toString("utf8") || "null"); }
  catch (error) {
    jsonResponse(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } }, headers);
    return;
  }
  if (!message || typeof message !== "object" || Array.isArray(message) || (!("method" in message) && !("result" in message) && !("error" in message))) {
    jsonResponse(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Petición JSON-RPC inválida." } }, headers);
    return;
  }
  if (!("method" in message) || message.id === undefined) {
    response.writeHead(202, headers);
    response.end();
    return;
  }
  const reply = await handle(message);
  if (!reply) {
    response.writeHead(202, headers);
    response.end();
    return;
  }
  jsonResponse(response, 200, reply, headers);
}

export function startHttpServer(options = {}) {
  const host = options.host ?? process.env.FUGU_MCP_HOST ?? "127.0.0.1";
  const port = Number(options.port ?? process.env.FUGU_MCP_PORT ?? 8788);
  const token = options.token ?? process.env.FUGU_MCP_TOKEN ?? "";
  const server = http.createServer((request, response) => {
    void handleHttp(request, response, token).catch(error => {
      if (!response.headersSent) jsonResponse(response, 500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: error.message } });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${boundPort}/mcp`;
      if (!token) process.stderr.write("Fugu MCP HTTP sin FUGU_MCP_TOKEN: cualquier cliente que alcance el puerto puede llamar las tools.\n");
      process.stderr.write(`Fugu MCP HTTP en ${url}\n`);
      resolve({ server, url, host, port: boundPort });
    });
  });
}

function startStdio() {
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  input.on("line", line => {
    if (!line.trim()) return;
    try { void handle(JSON.parse(line)).then(send); }
    catch (error) { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } }); }
  });
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--http") || process.env.FUGU_MCP_HTTP === "1") void startHttpServer();
  else startStdio();
}
