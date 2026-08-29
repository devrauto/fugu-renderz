import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE = path.join(ROOT, ".cache");
export const SESSION = path.join(CACHE, "bltr-session.json");
export const BLTR_API = process.env.BLTR_API_URL || "http://127.0.0.1:10108";
export const BLTR_BETA = process.env.BLTR_BETA_AUTOMATION_URL || "http://127.0.0.1:51090";
export const RENDERZ = process.env.RENDERZ_URL || "https://renderz.app/";
export const PROFILE_NAME = "fugu-renderz";
const TIMEOUT = Number(process.env.RENDERZ_AUTH_TIMEOUT_MS || 15 * 60_000);

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    const detail = [body.message, body.error, text].find(value => typeof value === "string" && value) || JSON.stringify(body);
    throw new Error(`${response.status} ${url}: ${detail}`);
  }
  return body;
}

export async function health() {
  const result = await request(`${BLTR_BETA}/beta/health`);
  if (!result.ok) throw new Error("BLTR beta no está listo.");
  return result;
}

export async function loadSession() {
  return JSON.parse(await fs.readFile(SESSION, "utf8"));
}

export async function saveSession(profileId) {
  await fs.mkdir(CACHE, { recursive: true, mode: 0o700 });
  await fs.writeFile(SESSION, JSON.stringify({ profileId, profileName: PROFILE_NAME }, null, 2), { mode: 0o600 });
}

export async function ensureDedicatedProfile() {
  try {
    const saved = await loadSession();
    const found = await request(`${BLTR_API}/v1/profiles/${saved.profileId}`);
    if (found.profile?.name !== PROFILE_NAME) throw new Error("El UUID guardado no pertenece a fugu-renderz.");
    return saved.profileId;
  } catch (error) {
    if (!(["ENOENT", "404"].some(value => String(error.code || error.message).includes(value)))) throw error;
  }

  const all = await request(`${BLTR_API}/v1/profiles`);
  const existing = all.profiles?.find(profile => profile.name === PROFILE_NAME);
  if (existing) {
    await saveSession(existing.id);
    return existing.id;
  }

  const versions = await request(`${BLTR_API}/v1/browsers/wayfern/versions`);
  const version = versions.at(-1);
  if (!version) throw new Error("BLTR no tiene ninguna versión de Wayfern disponible.");
  const created = await request(`${BLTR_API}/v1/profiles`, {
    method: "POST",
    body: JSON.stringify({
      name: PROFILE_NAME, browser: "wayfern", version, release_type: "stable",
      camoufox_config: {}, wayfern_config: {}, cloakbrowser_config: {},
      tags: ["fugu", "renderz"]
    })
  });
  await saveSession(created.profile.id);
  return created.profile.id;
}

export async function startProfile(profileId) {
  const info = await request(`${BLTR_API}/v1/profiles/${profileId}`);
  if (!info.profile.is_running) {
    await request(`${BLTR_API}/v1/profiles/${profileId}/run`, {
      method: "POST", body: JSON.stringify({ headless: false, url: RENDERZ })
    });
  } else {
    await request(`${BLTR_API}/v1/profiles/${profileId}/open-url`, {
      method: "POST", body: JSON.stringify({ url: RENDERZ })
    });
  }
}

export async function evaluate(profileId, expression) {
  const result = await request(`${BLTR_BETA}/beta/evaluate`, {
    method: "POST", body: JSON.stringify({ profile: profileId, expression, await_promise: true })
  });
  if (!result.ok || result.exception) throw new Error(result.error || result.exception || "Falló evaluate en BLTR.");
  return result.value;
}

export async function targets(profileId) {
  const result = await request(`${BLTR_BETA}/beta/targets?profile=${encodeURIComponent(profileId)}`);
  return result.targets || [];
}

export async function navigateTarget(profileId, targetId, url) {
  return request(`${BLTR_BETA}/beta/navigate`, {
    method: "POST",
    body: JSON.stringify({ profile: profileId, target_id: targetId, url })
  });
}

export async function evaluateTarget(profileId, targetId, expression) {
  const result = await request(`${BLTR_BETA}/beta/evaluate`, {
    method: "POST",
    body: JSON.stringify({ profile: profileId, target_id: targetId, expression, await_promise: true })
  });
  if (!result.ok || result.exception) throw new Error(result.error || result.exception || "Falló evaluate en BLTR.");
  return result.value;
}

export async function pageStatus(profileId) {
  return request(`${BLTR_BETA}/beta/page_info?profile=${encodeURIComponent(profileId)}&target_url=renderz.app`);
}

export async function waitUntilReady(profileId, timeout = TIMEOUT) {
  const deadline = Date.now() + timeout;
  let announced = false;
  while (Date.now() < deadline) {
    try {
      const status = await evaluate(profileId, `(() => {
        const text = document.body?.innerText || "";
        const challenge = /checking your browser|verify you are human|just a moment|security verification|cloudflare/i.test(text);
        return { challenge, ready: location.hostname.endsWith("renderz.app") && !challenge && /Search for players/i.test(text) };
      })()`);
      if (status?.ready) return;
      if (status?.challenge && !announced) {
        console.log("Se requiere intervención manual en la ventana de BLTR. Completa Cloudflare/CAPTCHA; el proceso continuará automáticamente.");
        announced = true;
      }
    } catch { /* la pestaña aún está arrancando */ }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error(`RenderZ no quedó listo en ${Math.round(timeout / 60_000)} minutos.`);
}

export async function searchNeymar(profileId) {
  const changed = await evaluate(profileId, `(() => {
    const input = document.querySelector('input[placeholder*="Search for players" i]');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Neymar");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error("No se encontró el buscador de jugadores.");
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await evaluate(profileId, `(() => {
      const text = document.body?.innerText || "";
      return { found: /Neymar Jr/i.test(text), challenged: /verify you are human|just a moment|cloudflare/i.test(text) };
    })()`);
    if (result?.found) return;
    if (result?.challenged) throw new Error("Cloudflare reapareció durante la búsqueda.");
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("La búsqueda no mostró resultados de Neymar.");
}
