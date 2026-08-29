import fs from "node:fs/promises";
import path from "node:path";
import { CACHE, ROOT, evaluateTarget, health, loadSession, targets } from "./bltr.js";
import { decodePositionModifiers, fetchBasePlayer, simulatePlayer } from "./renderz-model.js";
import { searchRenderzPlayers } from "./renderz-search.js";
import { fetchRenderzSquad } from "./squad-analysis.js";

export const MODEL_CACHE = path.join(CACHE, "position-modifiers.json");
export const SHIPPED_MODEL = path.join(ROOT, "data", "position-modifiers.json");
const FETCH_TIMEOUT_MS = Number(process.env.FUGU_FETCH_TIMEOUT_MS || 20_000);
const PLAYER_CACHE_LIMIT = 500;

const playerCache = new Map();
let modifiersPromise;

export function fetchWithTimeout(url, options = {}) {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...options });
}

function describeUpstream(error, what) {
  const message = String(error?.message || error);
  if (error?.name === "TimeoutError" || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|aborted|timeout/i.test(message)) {
    return new Error(`RenderZ no respondió al pedir ${what} (${message}). Comprueba la conexión y reintenta.`);
  }
  return error;
}

export async function getBrowserTarget() {
  await health();
  const { profileId } = await loadSession();
  const all = await targets(profileId);
  const target = all.find(item => item.type === "page" && /renderz\.app/.test(item.url))
    || all.find(item => item.type === "page" && /fcmobileforum/.test(item.url))
    || all.find(item => item.type === "page");
  if (!target) throw new Error("El perfil BLTR no tiene una pestaña disponible.");
  return { profileId, targetId: target.target_id };
}

async function fetchModifiersViaBrowser() {
  const { profileId, targetId } = await getBrowserTarget();
  const base64 = await evaluateTarget(profileId, targetId, `(async () => {
    const response = await fetch("/api/player/upgrade");
    if (!response.ok) throw new Error("RenderZ upgrade table: " + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
  })()`);
  return decodePositionModifiers(Buffer.from(base64, "base64"));
}

async function readJsonIfExists(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function buildModifiers(refresh) {
  if (!refresh) {
    const existing = (await readJsonIfExists(MODEL_CACHE)) || (await readJsonIfExists(SHIPPED_MODEL));
    if (existing) return existing;
  }
  try {
    const decoded = await fetchModifiersViaBrowser();
    await fs.mkdir(CACHE, { recursive: true, mode: 0o700 });
    await fs.writeFile(MODEL_CACHE, JSON.stringify(decoded), { mode: 0o600 });
    return decoded;
  } catch (error) {
    const fallback = (await readJsonIfExists(MODEL_CACHE)) || (await readJsonIfExists(SHIPPED_MODEL));
    if (fallback) return fallback;
    throw new Error(`No hay tabla de entrenamiento (${SHIPPED_MODEL} ni ${MODEL_CACHE}) y BLTR no pudo descargarla: ${error.message}.`);
  }
}

export function loadPositionModifiers(refresh = false) {
  if (refresh) modifiersPromise = undefined;
  if (!modifiersPromise) {
    modifiersPromise = buildModifiers(refresh);
    modifiersPromise.catch(() => { modifiersPromise = undefined; });
  }
  return modifiersPromise;
}

export async function getBasePlayer(playerId, refresh = false) {
  const id = String(playerId);
  if (refresh) playerCache.delete(id);
  if (!playerCache.has(id)) {
    if (playerCache.size >= PLAYER_CACHE_LIMIT) playerCache.delete(playerCache.keys().next().value);
    playerCache.set(id, fetchBasePlayer(id, fetchWithTimeout));
  }
  try { return await playerCache.get(id); }
  catch (error) {
    playerCache.delete(id);
    throw describeUpstream(error, `la ficha del jugador ${id}`);
  }
}

export async function searchPlayers(options = {}) {
  try { return await searchRenderzPlayers(options, fetchWithTimeout); }
  catch (error) { throw describeUpstream(error, "la búsqueda del catálogo"); }
}

export async function importRenderzSquad(squadId) {
  try { return await fetchRenderzSquad(squadId, fetchWithTimeout); }
  catch (error) { throw describeUpstream(error, `la plantilla ${squadId}`); }
}

export function engineDependencies(modifiers, { refreshPlayers = false } = {}) {
  return {
    getPlayer: id => getBasePlayer(id, refreshPlayers),
    simulate: (player, options) => simulatePlayer(player, modifiers, options),
    searchPlayers
  };
}
