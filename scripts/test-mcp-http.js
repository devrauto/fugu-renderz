import assert from "node:assert/strict";
import { startHttpServer } from "./mcp-server.js";

const TOKEN = "test-fugu-token";
const { server, url } = await startHttpServer({ host: "127.0.0.1", port: 0, token: TOKEN });

async function rpc(method, params, { token = TOKEN, id = 1 } = {}) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const card = await fetch(url);
assert.equal(card.status, 200);
const info = await card.json();
assert.equal(info.name, "fugu-fcmobile");
assert.equal(info.transport.sse, false);

const denied = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }, { token: "" });
assert.equal(denied.status, 401);

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "grok-bot-test", version: "1" } });
assert.equal(init.status, 200);
assert.equal(init.body.result.protocolVersion, "2025-06-18");
assert.equal(init.body.result.serverInfo.name, "fugu-fcmobile");

const notice = await fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
});
assert.equal(notice.status, 202);

const listed = await rpc("tools/list", {}, { id: 2 });
assert.equal(listed.status, 200);
const names = listed.body.result.tools.map(tool => tool.name);
assert.equal(names.includes("search_players"), true);
assert.equal(names.includes("analyze_squad_screenshot"), true);
assert.equal(names.includes("render_lineup_pitch"), true);
assert.equal(listed.body.result.tools.find(tool => tool.name === "inspect_squad_screenshot").inputSchema.oneOf, undefined);

const resources = await rpc("resources/list", {}, { id: 3 });
assert.equal(resources.body.result.resources.length, 0);
const prompts = await rpc("prompts/list", {}, { id: 4 });
assert.equal(prompts.body.result.prompts.length, 0);

const ping = await rpc("ping", {}, { id: 5 });
assert.equal(ping.body.result && Object.keys(ping.body.result).length, 0);

const model = await rpc("tools/call", { name: "get_scoring_model", arguments: {} }, { id: 6 });
assert.equal(model.status, 200);
assert.equal(typeof model.body.result.structuredContent.version, "string");

const unknown = await rpc("tools/call", { name: "not_a_tool", arguments: {} }, { id: 7 });
assert.equal(unknown.body.error.code, -32602);

const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const inspect = await rpc("tools/call", { name: "inspect_squad_screenshot", arguments: { imageBase64: tinyPng } }, { id: 8 });
assert.equal(inspect.status, 200);
assert.equal(inspect.body.result.structuredContent.status, "ready_for_visual_extraction");
assert.equal(inspect.body.result.content.some(item => item.type === "image" && item.mimeType === "image/png"), true);

const grokOrigin = await fetch(url, { headers: { origin: "https://grok.com" } });
assert.equal(grokOrigin.status, 200);
assert.equal(grokOrigin.headers.get("access-control-allow-origin"), "https://grok.com");

const origin = await fetch(url, { headers: { origin: "https://evil.example" } });
assert.equal(origin.status, 403);

server.close();
console.log(JSON.stringify({ ok: true, url, tools: names.length, protocol: init.body.result.protocolVersion }, null, 2));
