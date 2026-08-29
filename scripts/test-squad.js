import assert from "node:assert/strict";

const API = process.env.FUGU_API_URL || "http://127.0.0.1:8787";
const PUBLIC_SQUAD = "ejlnaBSxSNh38SNjyuh6P";

async function api(path, options) {
  const response = await fetch(`${API}${path}`, options);
  const body = await response.json();
  assert.equal(response.ok, true, `${path}: ${body.error || response.status}`);
  return body;
}

const uid = await api("/api/squads/uid/1054521024707137536");
assert.equal(uid.uid, "1054521024707137536");
assert.equal(uid.status, "needs_verification");
assert.equal(uid.safety.includes("inventa"), true);
const scoring = await api("/api/scoring/model");
assert.equal(scoring.playStyleAliases.INTIMIDATOR, "BRUISER");
assert.equal(scoring.playStyleAliases.AERIAL_DEFENSE, "PRECISION_HEADER");

const snapshot = await api(`/api/squads/renderz/${PUBLIC_SQUAD}`);
const starters = snapshot.players.filter(player => player.starter);
assert.equal(snapshot.formation.name, "4-3-3 HOLDING");
assert.equal(snapshot.players.length, 18);
assert.equal(starters.length, 11);
assert.equal(starters.find(player => player.cardName === "Dembélé")?.slot, "RW");
assert.equal(starters.find(player => player.cardName === "Márquez")?.slot, "CB");

const analyses = await Promise.all(["h2h", "vsa", "manager"].map(mode =>
  api(`/api/squads/renderz/${PUBLIC_SQUAD}/analyze?mode=${mode}`)));
assert.deepEqual(analyses.map(result => result.analysis.mode), ["h2h", "vsa", "manager"]);
for (const result of analyses) {
  assert.equal(result.analysis.players.length, 11);
  assert.equal(Number.isFinite(result.analysis.overallScore), true);
  assert.equal(result.analysis.assumptions.length >= 3, true);
}

const marketPage1 = await api("/api/players/search?positions=CB&auctionable=true&limit=2&rank=5");
assert.equal(marketPage1.players.length, 2);
assert.equal(marketPage1.players.every(player => player.position === "CB" && player.auctionable), true);
assert.equal(typeof marketPage1.nextCursor, "string");
const marketPage2 = await api(`/api/players/search?positions=CB&auctionable=true&limit=2&rank=5&cursor=${encodeURIComponent(marketPage1.nextCursor)}`);
assert.equal(marketPage2.players.length, 2);
assert.equal(marketPage2.players.some(player => marketPage1.players.some(first => first.renderzId === player.renderzId)), false);

const automatic = await api(`/api/squads/renderz/${PUBLIC_SQUAD}/auto-recommend?mode=h2h&auctionable=true&maxSlots=1&candidatesPerSlot=3&limit=3`);
assert.equal(automatic.result.discovery.evaluatedCandidates, 3);
assert.equal(automatic.result.recommendations.length > 0, true);
assert.equal(automatic.result.recommendations.every(item => item.candidate.market?.auctionable === true), true);
assert.equal(automatic.result.recommendations.every(item => Number.isFinite(item.candidate.market?.price)), true);

const recommendation = await api("/api/squads/recommend", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    squad: { mode: "h2h", formation: snapshot.formation.name, source: snapshot.source, players: starters },
    candidates: [
      { renderzId: "30919716", rank: 5, training: 30, slots: ["CB"] },
      { renderzId: "24049008", rank: 5, training: 30, slots: ["LB"] }
    ]
  })
});
assert.equal(recommendation.recommendations.length >= 2, true);
assert.equal(recommendation.recommendations[0].delta > 0, true);
assert.equal(recommendation.recommendations[0].candidate.optimizedSkills
  .reduce((sum, skill) => sum + skill.level, 0), 5);

console.log(JSON.stringify({
  ok: true,
  uid: uid.status,
  snapshot: { players: snapshot.players.length, starters: starters.length, formation: snapshot.formation.name },
  modes: analyses.map(result => ({ mode: result.analysis.mode, score: result.analysis.overallScore })),
  marketPagination: { first: marketPage1.players.map(player => player.renderzId), second: marketPage2.players.map(player => player.renderzId) },
  automaticRecommendation: automatic.result.recommendations[0],
  topRecommendation: recommendation.recommendations[0]
}, null, 2));
