import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const API = process.env.FUGU_API_URL || "http://127.0.0.1:8787";
const SQUAD_ID = "ejlnaBSxSNh38SNjyuh6P";

async function api(path, options) {
  const response = await fetch(`${API}${path}`, options);
  const body = await response.json();
  assert.equal(response.ok, true, body.error || `${response.status} ${path}`);
  return body;
}

function variantFromImage(url) {
  const file = String(url || "").split("?")[0].split("/").at(-1) || "";
  return file.match(/^player_\d+_\d+_(.+)_[0-9a-f]{12,}$/i)?.[1] || null;
}

const snapshot = await api(`/api/squads/renderz/${SQUAD_ID}`);
const observations = [];
for (const entry of snapshot.players.filter(player => player.starter)) {
  const { player } = await api(`/api/player/${entry.renderzId}`);
  observations.push({
    slot: entry.slot, name: entry.cardName, displayedOvr: player.rating + entry.rank,
    rank: entry.rank, training: entry.training, naturalPosition: entry.naturalPosition,
    program: player.source, variant: variantFromImage(player.images?.playerCardImage)
  });
}

const resolved = await api("/api/squads/screenshot/resolve", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    mode: "h2h", formation: snapshot.formation.name, captureHash: "fixture-public-squad",
    observations, recommendations: false
  })
});
assert.equal(resolved.status, "analyzed");
assert.equal(resolved.resolutions.length, 11);
assert.equal(resolved.resolutions.every(item => item.status === "resolved"), true);
assert.equal(resolved.analysis.players.length, 11);

const mbappe = observations.find(player => player.name === "Mbappé");
const ambiguous = await api("/api/squads/screenshot/resolve", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "h2h", recommendations: false, observations: [{ ...mbappe, variant: undefined }] })
});
assert.equal(ambiguous.status, "needs_clarification");
assert.equal(ambiguous.resolutions[0].candidates.length >= 2, true);

const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const child = spawn(process.execPath, ["scripts/mcp-server.js"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
const messages = [];
let pending = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", chunk => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop();
  for (const line of lines.filter(Boolean)) messages.push(JSON.parse(line));
});
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "screenshot-test", version: "1" } } })}\n`);
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "inspect_squad_screenshot", arguments: { imageBase64: tinyPng } } })}\n`);
for (let attempt = 0; attempt < 50 && messages.length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
child.kill("SIGTERM");
const imageResponse = messages.find(message => message.id === 2);
assert.equal(imageResponse?.result?.structuredContent?.status, "ready_for_visual_extraction");
assert.equal(imageResponse.result.content.some(content => content.type === "image" && content.mimeType === "image/png"), true);

console.log(JSON.stringify({
  ok: true, imageTransport: imageResponse.result.structuredContent,
  resolvedPlayers: resolved.resolutions.length, resolutionConfidence: resolved.resolutionConfidence,
  ambiguityGuard: ambiguous.resolutions[0].issues,
  analysis: { formation: resolved.analysis.formation, score: resolved.analysis.overallScore }
}, null, 2));
