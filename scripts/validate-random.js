import { evaluateTarget, loadSession, targets } from "./bltr.js";

const API = process.env.FUGU_API_URL || "http://127.0.0.1:8787";
const SAMPLE_SIZE = Number(process.env.RANDOM_PLAYER_COUNT || 15);
const SEED = Number(process.env.RANDOM_SEED || Date.now());
const FALLBACK_IDS = [
  "30919738", "30919728", "30919726", "30919722", "30919720", "30919719",
  "30919718", "30919716", "30919714", "30919712", "30919711", "30919710"
];
// Cartas reales que completan las posiciones menos frecuentes del listado de
// "últimos añadidos". La selección final sigue siendo aleatoria por posición.
const POSITION_DIVERSITY_IDS = [
  "24036284", // CDM - Kimmich
  "24049024", // LW  - Mbappe
  "24004687", // RB  - Carvajal
  "24038729", // RM  - Olise
  "24005589", // RWB - Cash
  "24033564", // LM  - Raphinha
  "24005660", // LWB - Robertson
  "24002316"  // CF  - Depay
];

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

const random = mulberry32(SEED >>> 0);
const randomInteger = (min, max) => Math.floor(random() * (max - min + 1)) + min;

async function api(path, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${API}${path}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `${response.status} ${path}`);
      return body;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

async function discoverLatestPlayers() {
  try {
    const { profileId } = await loadSession();
    const all = await targets(profileId);
    const page = all.find(item => item.type === "page" && /renderz\.app\/24\/players/.test(item.url))
      || all.find(item => item.type === "page" && item.url.includes("renderz.app") && !item.url.includes("/24/player/"));
    if (!page) return FALLBACK_IDS;
    try {
      await evaluateTarget(profileId, page.target_id, `location.assign("https://renderz.app/24/players?sortType=added"); true`);
    } catch { /* el contexto cambia durante la navegación */ }
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const state = await evaluateTarget(profileId, page.target_id, `({
          href: location.href,
          ids: Array.from(document.querySelectorAll('a[href*="/24/player/"]'))
            .map(a => a.href.match(/\\/24\\/player\\/(\\d+)/)?.[1]).filter(Boolean)
        })`);
        const unique = [...new Set(state?.ids || [])];
        if (state?.href?.includes("/24/players") && unique.length >= 8) return unique;
      } catch { /* documento en transición */ }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  } catch (error) {
    console.warn("No se pudo renovar el listado con BLTR; se usa la última muestra conocida:", error.message);
  }
  return FALLBACK_IDS;
}

function shuffled(values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index--) {
    const swap = randomInteger(0, index);
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function validSkillBuilds(player, rank) {
  const branches = player.skillsData || [];
  const combinations = [];
  function visit(index, selected) {
    if (index === branches.length) {
      const acquired = new Map(selected.map(item => [item.id, item.level]));
      const spent = selected.reduce((sum, item) => sum + item.level, 0);
      const requirementsMet = selected.every(item => {
        const branch = branches.find(candidate => candidate.skill.id === item.id);
        return !branch.requirement || (acquired.get(branch.requirement.skillId) || 0) >= branch.requirement.level;
      });
      if (spent <= rank && requirementsMet) combinations.push(selected);
      return;
    }
    visit(index + 1, selected);
    for (const level of branches[index].skill.levels || []) {
      visit(index + 1, [...selected, { id: level.id, level: level.level }]);
    }
  }
  visit(0, []);
  return combinations;
}

function compare(local, oracle) {
  const differences = [];
  if (local.displayedOvr !== oracle.card.displayedOvr) {
    differences.push({ field: "displayedOvr", local: local.displayedOvr, renderz: oracle.card.displayedOvr });
  }
  for (const [field, expected] of Object.entries(oracle.faceStats || {})) {
    if (local.faceStats[field] !== expected) differences.push({ field: `faceStats.${field}`, local: local.faceStats[field], renderz: expected });
  }
  for (const [field, expected] of Object.entries(oracle.detailedStats || {})) {
    if (local.stats[field] !== expected) differences.push({ field: `stats.${field}`, local: local.stats[field], renderz: expected });
  }
  const expectedDetails = local.position === "GK" ? 11 : 28;
  if (Object.keys(oracle.detailedStats || {}).length < expectedDetails) {
    differences.push({ field: "oracle.detailCoverage", local: expectedDetails, renderz: Object.keys(oracle.detailedStats || {}).length });
  }
  return differences;
}

function queryFor(configuration) {
  const query = new URLSearchParams({ rank: String(configuration.rank), training: String(configuration.training) });
  if (configuration.skills.length) query.set("skills", configuration.skills.map(skill => `${skill.id}.${skill.level}`).join("-"));
  return query.toString();
}

const discovered = await discoverLatestPlayers();
const candidates = shuffled([...new Set([...discovered, ...POSITION_DIVERSITY_IDS])]);
const candidatesByPosition = new Map();
for (const playerId of candidates) {
  const { player } = await api(`/api/player/${playerId}`);
  const group = candidatesByPosition.get(player.position) || [];
  group.push(playerId);
  candidatesByPosition.set(player.position, group);
}

// Primero cubre tantas posiciones distintas como sea posible. Si el tamaño
// solicitado es mayor, rellena el resto con otras cartas aleatorias sin repetir.
const playerIds = [];
for (const [, ids] of shuffled([...candidatesByPosition.entries()])) {
  playerIds.push(shuffled(ids)[0]);
  if (playerIds.length === SAMPLE_SIZE) break;
}
if (playerIds.length < SAMPLE_SIZE) {
  const selected = new Set(playerIds);
  playerIds.push(...shuffled(candidates.filter(id => !selected.has(id))).slice(0, SAMPLE_SIZE - playerIds.length));
}
let builds = 0;
let assertions = 0;
const failures = [];

console.log(`Semilla: ${SEED}`);
console.log(`Jugadores reales seleccionados de RenderZ: ${playerIds.join(", ")}\n`);

for (const playerId of playerIds) {
  const { player } = await api(`/api/player/${playerId}`);
  const randomRank = randomInteger(0, 5);
  const configurations = [{ rank: randomRank, training: randomInteger(0, 30), skills: [] }];
  const skillBuilds = validSkillBuilds(player, 5).filter(build => build.length > 0);
  configurations.push({ rank: 5, training: randomInteger(0, 30), skills: skillBuilds[randomInteger(0, skillBuilds.length - 1)] || [] });

  for (const configuration of configurations) {
    const query = queryFor(configuration);
    const [local, oracle] = await Promise.all([
      api(`/api/simulate/${playerId}?${query}`),
      api(`/api/build/${playerId}?${query}`, 3)
    ]);
    const differences = compare(local, oracle);
    builds++;
    assertions += 1 + Object.keys(oracle.faceStats || {}).length + Object.keys(oracle.detailedStats || {}).length;
    const skillText = configuration.skills.length ? configuration.skills.map(skill => `${skill.id}.${skill.level}`).join("-") : "sin skills";
    console.log(`${differences.length ? "FAIL" : "PASS"} ${local.name} (${local.position}) r${configuration.rank} t${configuration.training} ${skillText}`);
    if (differences.length) failures.push({ playerId, name: local.name, configuration, differences });
  }
}

console.log(`\nResultado: ${builds - failures.length}/${builds} builds; ${assertions} valores contrastados.`);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
} else {
  console.log("Sin diferencias entre el motor local y RenderZ.");
}
