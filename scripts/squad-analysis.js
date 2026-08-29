import vm from "node:vm";

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const statScore = value => clamp(((Number(value) || 0) - 70) / 1.5);

export const MODEL_VERSION = "squad-meta-2026.08.02-v3";
export const MODES = ["h2h", "vsa", "manager"];

export const ROLE_PROFILES = {
  GK: { ref: .24, gkp: .20, gkd: .18, han: .15, rea: .10, agi: .05, spd: .04, str: .04 },
  CB: { awr: .17, stt: .14, mrk: .12, rea: .11, spd: .10, acc: .09, str: .09, agg: .06, hea: .05, jmp: .04, slt: .03 },
  LB: { acc: .13, spd: .13, awr: .12, stt: .10, rea: .09, mrk: .08, sta: .08, cro: .07, spa: .06, str: .05, agi: .05, bac: .04 },
  RB: null, LWB: null, RWB: null,
  CDM: { awr: .14, stt: .12, rea: .10, mrk: .09, str: .08, agg: .07, spa: .09, lpa: .08, vis: .06, sta: .07, bac: .05, acc: .03, spd: .02 },
  CM: { spa: .13, lpa: .11, vis: .11, bac: .10, rea: .09, sta: .09, agi: .07, dri: .06, awr: .06, acc: .05, stt: .05, pos: .04, sho: .04 },
  CAM: { vis: .13, spa: .11, bac: .11, dri: .10, agi: .10, rea: .09, pos: .08, fin: .07, cur: .06, lpa: .05, acc: .05, sho: .05 },
  LM: { acc: .13, spd: .12, dri: .11, agi: .10, bac: .10, cro: .09, sta: .08, spa: .07, vis: .06, fin: .05, cur: .05, rea: .04 },
  RM: null,
  LW: { acc: .15, spd: .13, dri: .12, agi: .11, bac: .10, fin: .09, cur: .07, pos: .06, rea: .06, sho: .05, sta: .04, cro: .02 },
  RW: null,
  CF: { fin: .14, pos: .13, rea: .11, bac: .10, dri: .09, spa: .08, vis: .08, sho: .07, acc: .06, agi: .05, str: .04, lsa: .03, spd: .02 },
  ST: { fin: .17, pos: .14, rea: .11, sho: .10, acc: .10, spd: .08, bac: .07, str: .06, agi: .05, hea: .04, jmp: .03, lsa: .03, dri: .02 }
};
ROLE_PROFILES.RB = ROLE_PROFILES.LB;
ROLE_PROFILES.LWB = ROLE_PROFILES.LB;
ROLE_PROFILES.RWB = ROLE_PROFILES.LB;
ROLE_PROFILES.RM = ROLE_PROFILES.LM;
ROLE_PROFILES.RW = ROLE_PROFILES.LW;

const PLAYSTYLE_RULES = {
  TIKI_TAKA: { roles: ["CDM", "CM", "CAM", "CF"], modes: { h2h: 1, vsa: .55, manager: .9 }, stats: ["spa", "lpa", "vis", "bac"] },
  BULLET_PASS: { roles: ["CB", "CDM", "CM", "CAM"], modes: { h2h: .95, vsa: .55, manager: .9 }, stats: ["spa", "lpa", "vis"] },
  WHIPPED_CROSS: { roles: ["LB", "RB", "LWB", "RWB", "LM", "RM", "LW", "RW"], modes: { h2h: .8, vsa: .35, manager: .65 }, stats: ["cro", "cur", "vis"] },
  RAPID: { roles: ["LM", "RM", "LW", "RW", "ST", "CF"], modes: { h2h: 1, vsa: .8, manager: .65 }, stats: ["acc", "spd", "dri", "bac"] },
  TRICKSTER: { roles: ["CAM", "LM", "RM", "LW", "RW", "CF", "ST"], modes: { h2h: 1, vsa: .9, manager: .25 }, stats: ["dri", "agi", "bac", "bal"] },
  FINESSE: { roles: ["CAM", "LM", "RM", "LW", "RW", "CF", "ST"], modes: { h2h: 1, vsa: 1, manager: .8 }, stats: ["fin", "cur", "lsa", "sho"] },
  CLINICAL: { roles: ["CAM", "CF", "ST"], modes: { h2h: .85, vsa: 1, manager: .9 }, stats: ["fin", "pos", "sho", "rea"] },
  POWER_SHOT: { roles: ["CM", "CAM", "CF", "ST"], modes: { h2h: .75, vsa: .85, manager: .75 }, stats: ["sho", "lsa", "fin"] },
  CHIP_SHOT: { roles: ["CF", "ST"], modes: { h2h: .3, vsa: .25, manager: .2 }, stats: ["fin", "pos"] },
  PENALTY: { roles: ["ST", "CF", "CAM"], modes: { h2h: .1, vsa: .05, manager: .1 }, stats: ["pen", "sho"] },
  ANTICIPATE: { roles: ["CB", "LB", "RB", "LWB", "RWB", "CDM"], modes: { h2h: 1, vsa: .8, manager: .9 }, stats: ["stt", "awr", "rea", "mrk"] },
  GUARDIAN: { roles: ["CB", "CDM"], modes: { h2h: .65, vsa: .55, manager: .7 }, stats: ["stt", "agg", "str", "awr"] },
  ACCELERATOR: { roles: ["CB", "LB", "RB", "LWB", "RWB", "LM", "RM", "LW", "RW", "ST"], modes: { h2h: .95, vsa: .55, manager: .75 }, stats: ["acc", "spd", "sta"] },
  RELENTLESS: { roles: ["LB", "RB", "LWB", "RWB", "CDM", "CM", "LM", "RM"], modes: { h2h: .75, vsa: .2, manager: .9 }, stats: ["sta"] },
  BRUISER: { roles: ["CB", "CDM", "CF", "ST"], modes: { h2h: .9, vsa: .45, manager: .85 }, stats: ["str", "agg", "bal"] },
  PRECISION_HEADER: { roles: ["CB", "CF", "ST"], modes: { h2h: .55, vsa: .45, manager: .6 }, stats: ["hea", "jmp", "str"] },
  DEFLECTOR: { roles: ["GK"], modes: { h2h: .8, vsa: 1, manager: .85 }, stats: ["ref", "han", "gkp"] },
  RUSH_OUT: { roles: ["GK"], modes: { h2h: 1, vsa: .55, manager: .75 }, stats: ["ref", "gkp", "spd", "rea"] }
};

const PLAYSTYLE_ALIASES = {
  Finesse: "FINESSE", FINESSE_EXPERT: "FINESSE", FINESSE_SHOT: "FINESSE", CLINICAL_FINISHER: "CLINICAL",
  POWER: "POWER_SHOT", PENALTY_EXPERT: "PENALTY", CHIP: "CHIP_SHOT",
  WHIPPED: "WHIPPED_CROSS", WHIPPED_CROSSER: "WHIPPED_CROSS", SPEED_DRIBBLER: "RAPID",
  ANTICIPATION: "ANTICIPATE", STAND_TACKLE_MASTER: "ANTICIPATE", HARD_TACKLE_MASTER: "GUARDIAN",
  ACCELERATION: "ACCELERATOR", RELENTLESS_STAMINA: "RELENTLESS",
  INTIMIDATOR: "BRUISER", AERIAL_DEFENSE: "PRECISION_HEADER", PRECISE_HEADER: "PRECISION_HEADER",
  REPELBALLS: "DEFLECTOR", RUSH: "RUSH_OUT", SUPER_RUSH: "RUSH_OUT"
};

function normalizedPlayStyleName(playStyle) {
  const raw = String(playStyle.name || playStyle.levelName || "").replace(/^PLAYSTYLE_/, "").replace(/_[12]$/, "");
  return PLAYSTYLE_ALIASES[raw] || raw;
}

function weightedStats(stats, profile) {
  return Object.entries(profile).reduce((sum, [field, weight]) => sum + statScore(stats[field]) * weight, 0);
}

function parseStars(value) {
  return Number(String(value || "").match(/([1-5])/)?.[1] || 3);
}

function heightCm(player) {
  return Number(String(player.height || "").match(/\((\d+)\s*cm\)/i)?.[1] || 0);
}

function positionFit(player, slot) {
  if (!slot || slot === player.position) return 100;
  if ((player.potentialPositions || []).includes(slot)) return 88;
  return 45;
}

function bodyFit(player, slot) {
  const height = heightCm(player);
  if (slot === "GK") return clamp(55 + (height - 180) * 2);
  if (slot === "CB") return clamp(60 + (height - 178) * 1.6);
  if (["ST", "CF"].includes(slot)) return clamp(72 + Math.abs(height - 184) * -.5);
  if (["CAM", "LW", "RW", "LM", "RM"].includes(slot)) return clamp(92 - Math.max(0, height - 180) * 1.2);
  return 78;
}

function workRateFit(player, slot, mode) {
  const value = String(player.workRates || "Medium/Medium").toLowerCase();
  const [attack = "medium", defense = "medium"] = value.split("/");
  let score = 72;
  if (["CB", "CDM"].includes(slot)) score += defense.includes("high") ? 18 : defense.includes("low") ? -22 : 5;
  if (["LW", "RW", "CAM", "ST", "CF"].includes(slot)) score += attack.includes("high") ? 16 : attack.includes("low") ? -15 : 4;
  if (["LB", "RB", "LWB", "RWB", "CM"].includes(slot) && attack.includes("high") && defense.includes("high")) score += mode === "manager" ? 12 : 8;
  return clamp(score);
}

function techniqueFit(player, slot) {
  const weakFoot = parseStars(player.weakFootRating);
  const skillMoves = parseStars(player.skillMovesLevel);
  const attacking = ["CAM", "LM", "RM", "LW", "RW", "CF", "ST"].includes(slot);
  return clamp(attacking ? weakFoot * 12 + skillMoves * 8 : weakFoot * 9 + skillMoves * 5 + 28);
}

function playStyleFit(player, stats, slot, mode) {
  const details = [];
  for (const playStyle of player.playStyles || []) {
    const name = normalizedPlayStyleName(playStyle);
    const rule = PLAYSTYLE_RULES[name];
    if (!rule || !rule.roles.includes(slot)) continue;
    const readiness = rule.stats.reduce((sum, field) => sum + statScore(stats[field]), 0) / rule.stats.length;
    const level = Number(playStyle.level || 1) >= 2 ? 1 : .6;
    const impact = readiness * level * rule.modes[mode];
    details.push({ name, level: Number(playStyle.level || 1), impact: Math.round(impact * 10) / 10 });
  }
  return { score: details.length ? clamp(details.reduce((sum, item) => sum + item.impact, 0) / Math.sqrt(details.length)) : 35, details };
}

export function scorePlayer(player, simulated, { slot = player.position, mode = "h2h" } = {}) {
  if (!MODES.includes(mode)) throw new Error(`Modo inválido: ${mode}`);
  const profile = ROLE_PROFILES[slot] || ROLE_PROFILES[player.position];
  if (!profile) throw new Error(`No hay perfil para la posición ${slot}.`);
  const technical = weightedStats(simulated.stats, profile);
  const playStyles = playStyleFit(player, simulated.stats, slot, mode);
  const components = {
    technical, playStyles: playStyles.score, body: bodyFit(player, slot),
    workRates: workRateFit(player, slot, mode), technique: techniqueFit(player, slot), position: positionFit(player, slot)
  };
  const weights = mode === "h2h"
    ? { technical: .50, playStyles: .15, body: .14, workRates: .08, technique: .08, position: .05 }
    : mode === "vsa"
      ? { technical: .56, playStyles: .18, body: .07, workRates: .03, technique: .11, position: .05 }
      : { technical: .45, playStyles: .15, body: .10, workRates: .16, technique: .04, position: .10 };
  const score = Object.entries(weights).reduce((sum, [key, weight]) => sum + components[key] * weight, 0);
  return {
    score: Math.round(score * 10) / 10, slot, naturalPosition: player.position,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.round(value * 10) / 10])),
    playStyles: playStyles.details,
    confidence: playStyles.details.length ? .78 : .72,
    evidence: { technical: "exact", playerData: "observed", tacticalScore: "estimated" }
  };
}

export function optimizePlayerBuild(player, dependencies, { slot = player.position, mode = "h2h", rank = 5, training = 30 } = {}) {
  const branches = (player.skillsData || []).map(item => ({
    id: Number(item.skill.id),
    levels: (item.skill.levels || []).map(level => Number(level.level)).filter(Number.isInteger)
  }));
  let best = null;
  function visit(index, selected, spent) {
    if (spent > rank) return;
    if (index < branches.length) {
      visit(index + 1, selected, spent);
      const branch = branches[index];
      for (const level of branch.levels) visit(index + 1, [...selected, { id: branch.id, level }], spent + level);
      return;
    }
    try {
      const simulated = dependencies.simulate(player, { rank, training, skills: selected });
      const analysis = scorePlayer(player, simulated, { slot, mode });
      if (!best || analysis.score > best.analysis.score
        || (analysis.score === best.analysis.score && spent > best.simulated.skillPoints.spent)) {
        best = { simulated, analysis };
      }
    } catch {
      // Se descartan combinaciones que incumplen requisitos entre nodos.
    }
  }
  visit(0, [], 0);
  if (!best) throw new Error(`No se encontró una build válida para ${player.cardName || player.id}.`);
  return best;
}

function teamFindings(rows, input) {
  const sorted = [...rows].sort((a, b) => a.analysis.score - b.analysis.score);
  const weaknesses = sorted.slice(0, Math.min(3, sorted.length)).map(row => ({
    slot: row.slot, player: row.simulated.name, score: row.analysis.score,
    reason: row.analysis.components.position < 80 ? "fuera de posición" : "menor encaje relativo en el sistema"
  }));
  const strengths = [...sorted].reverse().slice(0, Math.min(3, sorted.length)).map(row => ({
    slot: row.slot, player: row.simulated.name, score: row.analysis.score,
    reason: row.analysis.playStyles.length ? `PlayStyles relevantes: ${row.analysis.playStyles.map(item => item.name).join(", ")}` : "atributos sólidos para el rol"
  }));
  const risks = [];
  const defenders = rows.filter(row => ["CB", "LB", "RB", "LWB", "RWB", "CDM"].includes(row.slot));
  if (defenders.length && defenders.filter(row => row.analysis.components.workRates < 60).length >= 2) risks.push("La estructura defensiva combina varios work rates de riesgo.");
  const attackers = rows.filter(row => ["CAM", "LW", "RW", "CF", "ST"].includes(row.slot));
  if (input.mode === "vsa" && attackers.filter(row => row.analysis.components.technique < 76).length) risks.push("Hay atacantes con pierna mala/filigranas por debajo del perfil ideal de VSA.");
  return { strengths, weaknesses, tacticalRisks: risks };
}

export async function analyzeSquad(input, dependencies) {
  if (!input || !Array.isArray(input.players) || input.players.length === 0) throw new Error("players debe contener al menos una carta.");
  const mode = input.mode || "h2h";
  if (!MODES.includes(mode)) throw new Error(`Modo inválido: ${mode}`);
  const rows = [];
  for (const entry of input.players) {
    const id = String(entry.renderzId || entry.playerId || "");
    if (!/^\d+$/.test(id)) throw new Error(`renderzId inválido: ${id}`);
    const player = await dependencies.getPlayer(id);
    const simulated = dependencies.simulate(player, {
      rank: Number(entry.rank ?? 5), training: Number(entry.training ?? 30), skills: entry.skills || []
    });
    const slot = entry.slot || player.position;
    rows.push({ id, slot, player, simulated, analysis: scorePlayer(player, simulated, { slot, mode }) });
  }
  const findings = teamFindings(rows, { ...input, mode });
  const overallScore = rows.reduce((sum, row) => sum + row.analysis.score, 0) / rows.length;
  return {
    modelVersion: MODEL_VERSION, dataAsOf: new Date().toISOString(), mode,
    source: input.source || { type: "manual" }, formation: input.formation || null,
    techniqueProfile: input.techniqueProfile || "balanced",
    overallScore: Math.round(overallScore * 10) / 10,
    displayedOvrAverage: Math.round(rows.reduce((sum, row) => sum + row.simulated.displayedOvr, 0) / rows.length * 10) / 10,
    players: rows.map(({ id, slot, simulated, analysis }) => ({ renderzId: id, slot, name: simulated.name, displayedOvr: simulated.displayedOvr, analysis })),
    ...findings,
    assumptions: [
      "Las puntuaciones tácticas son heurísticas versionadas, no coeficientes secretos de EA.",
      "Los atributos, rango, entrenamiento y skills proceden del motor exacto validado contra RenderZ.",
      "PlayStyles se valoran sólo cuando su acción es relevante para el rol y el modo."
    ]
  };
}

export async function recommendChanges(input, dependencies) {
  if (!input?.squad || !Array.isArray(input.candidates) || !input.candidates.length) {
    throw new Error("Se requieren squad y candidates para comparar reemplazos reales.");
  }
  const current = await analyzeSquad(input.squad, dependencies);
  const mode = input.squad.mode || "h2h";
  const incumbentBySlot = new Map();
  for (const incumbent of current.players) {
    const existing = incumbentBySlot.get(incumbent.slot);
    if (!existing || incumbent.analysis.score < existing.analysis.score) incumbentBySlot.set(incumbent.slot, incumbent);
  }
  const recommendations = [];
  for (const candidateInput of input.candidates) {
    const id = String(candidateInput.renderzId || candidateInput.playerId || "");
    const player = await dependencies.getPlayer(id);
    const rank = Number(candidateInput.rank ?? 5);
    const training = Number(candidateInput.training ?? 30);
    const requestedSlots = candidateInput.slots || [player.position, ...(player.potentialPositions || [])];
    for (const slot of requestedSlots) {
      const incumbent = incumbentBySlot.get(slot);
      if (!incumbent) continue;
      const build = candidateInput.skills === undefined
        ? optimizePlayerBuild(player, dependencies, { slot, mode, rank, training })
        : (() => {
            const simulated = dependencies.simulate(player, { rank, training, skills: candidateInput.skills });
            return { simulated, analysis: scorePlayer(player, simulated, { slot, mode }) };
          })();
      const { simulated, analysis } = build;
      const delta = Math.round((analysis.score - incumbent.analysis.score) * 10) / 10;
      if (delta <= 0) continue;
      recommendations.push({
        action: "replace", slot, incumbent: { renderzId: incumbent.renderzId, name: incumbent.name, score: incumbent.analysis.score },
        candidate: {
          renderzId: id, name: simulated.name, displayedOvr: simulated.displayedOvr, score: analysis.score,
          optimizedSkills: simulated.skillUpgrades,
          market: candidateInput.market || null
        },
        delta, confidence: Math.min(analysis.confidence, incumbent.analysis.confidence),
        reasons: [
          { kind: "exact", claim: `Build calculada a ${simulated.displayedOvr} OVR`, source: "Fugu exact RenderZ model" },
          { kind: "estimated", claim: `Mejora ${delta} puntos el encaje ${mode.toUpperCase()} en ${slot}`, source: MODEL_VERSION },
          ...(analysis.playStyles.length ? [{ kind: "observed", claim: `PlayStyles relevantes: ${analysis.playStyles.map(item => `${item.name} L${item.level}`).join(", ")}`, source: "RenderZ card data" }] : [])
        ],
        tradeoffs: analysis.components.position < 80 ? ["El candidato no tiene la posición como principal."] : []
      });
    }
  }
  recommendations.sort((a, b) => b.delta - a.delta);
  return { modelVersion: MODEL_VERSION, mode, currentScore: current.overallScore, recommendations: recommendations.slice(0, Number(input.limit || 10)) };
}

export async function autoRecommendChanges(input, dependencies) {
  if (!input?.squad || typeof dependencies.searchPlayers !== "function") {
    throw new Error("Se requieren squad y el buscador actual de RenderZ.");
  }
  const market = input.market || {};
  const rank = Number(market.rank ?? 5);
  const training = Number(market.training ?? 30);
  const current = await analyzeSquad(input.squad, dependencies);
  const requestedSlots = Array.isArray(market.slots) && market.slots.length
    ? [...new Set(market.slots)]
    : [...new Set([...current.players]
        .sort((a, b) => a.analysis.score - b.analysis.score)
        .map(player => player.slot))]
        .slice(0, Number(market.maxSlots || 3));
  const existingIds = new Set(current.players.map(player => player.renderzId));
  const searches = await Promise.all(requestedSlots.map(async slot => ({
    slot,
    result: await dependencies.searchPlayers({
      positions: [slot], limit: Number(market.maxCandidatesPerSlot || 8),
      auctionable: market.auctionable !== false, maxPrice: market.maxPrice,
      minOvr: market.minOvr, maxOvr: market.maxOvr, rank, sort: market.sort || "rating"
    })
  })));
  const candidates = searches.flatMap(({ slot, result }) => result.players
    .filter(player => !existingIds.has(player.renderzId))
    .map(player => ({
      renderzId: player.renderzId, rank, training, slots: [slot],
      market: { price: player.price, auctionable: player.auctionable, baseOvr: player.rating, added: player.added }
    })));
  if (!candidates.length) {
    return {
      modelVersion: MODEL_VERSION, mode: input.squad.mode || "h2h", currentScore: current.overallScore, recommendations: [],
      discovery: {
        source: "RenderZ live search", slots: requestedSlots, evaluatedCandidates: 0,
        filters: { auctionable: market.auctionable !== false, maxPrice: market.maxPrice ?? null, rank, training },
        note: "No se encontraron cartas que cumplan los filtros; no se fabricaron alternativas."
      }
    };
  }
  const result = await recommendChanges({ squad: input.squad, candidates, limit: input.limit || 10 }, dependencies);
  return {
    ...result,
    discovery: {
      source: "RenderZ live search", slots: requestedSlots, evaluatedCandidates: candidates.length,
      filters: { auctionable: market.auctionable !== false, maxPrice: market.maxPrice ?? null, rank, training }
    }
  };
}

function normalizedIdentity(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nameSimilarity(observed, candidate) {
  const left = normalizedIdentity(observed);
  const right = normalizedIdentity(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return .9;
  const a = new Set(left.split(" "));
  const b = new Set(right.split(" "));
  const overlap = [...a].filter(token => b.has(token)).length;
  return overlap / Math.max(a.size, b.size);
}

function playStyleFingerprint(candidate) {
  return (candidate.playStyles || []).map(style => `${style.name}:${style.level}`).sort().join("|");
}

function variantSimilarity(observed, candidate) {
  const left = normalizedIdentity(observed).split(" ").filter(Boolean);
  const right = normalizedIdentity(candidate).split(" ").filter(Boolean);
  if (!left.length || !right.length || left[0] !== right[0]) return 0;
  if (left.join(" ") === right.join(" ")) return 1;
  const overlap = left.filter(token => right.includes(token)).length;
  return overlap / Math.max(left.length, right.length);
}

export async function resolveScreenshotSquad(input, dependencies) {
  if (!input || !Array.isArray(input.observations) || !input.observations.length) {
    throw new Error("observations debe contener los jugadores leídos de la captura.");
  }
  const mode = input.mode || "h2h";
  if (!MODES.includes(mode)) throw new Error(`Modo inválido: ${mode}`);
  const resolutions = [];
  for (const [index, observation] of input.observations.entries()) {
    const issues = [];
    const displayedOvr = Number(observation.displayedOvr);
    const training = Number(observation.training);
    const explicitRank = observation.rank === undefined ? null : Number(observation.rank);
    if (!observation.name) issues.push("nombre no legible");
    if (!observation.slot || !ROLE_PROFILES[observation.slot]) issues.push("posición de la formación no legible o inválida");
    if (!Number.isInteger(displayedOvr)) issues.push("OVR mostrado no legible");
    if (!Number.isInteger(training) || training < 0 || training > 30) issues.push("nivel de entrenamiento no legible (0-30)");
    if (explicitRank !== null && (!Number.isInteger(explicitRank) || explicitRank < 0 || explicitRank > 5)) issues.push("rango no válido (0-5)");
    if (issues.length) {
      resolutions.push({ index, observation, status: "needs_clarification", issues, candidates: [] });
      continue;
    }
    const minOvr = explicitRank === null ? displayedOvr - 5 : displayedOvr - explicitRank;
    const maxOvr = explicitRank === null ? displayedOvr : displayedOvr - explicitRank;
    const search = await dependencies.searchPlayers({
      text: observation.name, auctionable: false, limit: 20,
      minOvr: Math.max(1, minOvr), maxOvr: Math.max(1, maxOvr), sort: "rating"
    });
    const ranked = search.players.map(candidate => {
      const inferredRank = explicitRank ?? displayedOvr - candidate.rating;
      const validRank = Number.isInteger(inferredRank) && inferredRank >= 0 && inferredRank <= 5;
      const ovrExact = validRank && candidate.rating + inferredRank === displayedOvr;
      const name = nameSimilarity(observation.name, candidate.name);
      const program = observation.program
        ? (normalizedIdentity(candidate.program).includes(normalizedIdentity(observation.program)) ? 1 : 0)
        : .5;
      const variant = observation.variant ? variantSimilarity(observation.variant, candidate.variant) : .5;
      const position = candidate.position === (observation.naturalPosition || observation.slot) ? 1 : .45;
      const confidence = clamp(name * .55 + (ovrExact ? 1 : 0) * .23 + position * .07 + program * .03 + variant * .12, 0, 1);
      return { ...candidate, inferredRank, confidence: Math.round(confidence * 1000) / 1000, ovrExact };
    }).filter(candidate => candidate.ovrExact).sort((a, b) => b.confidence - a.confidence || b.rating - a.rating);
    const best = ranked[0];
    const second = ranked[1];
    const equivalent = best && second
      && normalizedIdentity(best.name) === normalizedIdentity(second.name)
      && best.rating === second.rating && best.position === second.position
      && playStyleFingerprint(best) === playStyleFingerprint(second);
    const ambiguous = !best || best.confidence < .72
      || (second && Math.round((best.confidence - second.confidence) * 1000) < 60 && !equivalent);
    if (ambiguous) {
      resolutions.push({
        index, observation, status: "needs_clarification",
        issues: [best ? "varias cartas encajan con la lectura" : "ninguna carta coincide con nombre y OVR"],
        candidates: ranked.slice(0, 5)
      });
      continue;
    }
    resolutions.push({
      index, observation, status: "resolved", confidence: best.confidence,
      equivalentVariants: equivalent ? ranked.filter(candidate => normalizedIdentity(candidate.name) === normalizedIdentity(best.name)
        && candidate.rating === best.rating && candidate.position === best.position
        && playStyleFingerprint(candidate) === playStyleFingerprint(best)).length : 1,
      match: best
    });
  }
  const unresolved = resolutions.filter(item => item.status !== "resolved");
  if (unresolved.length) {
    return {
      status: "needs_clarification", mode, captureHash: input.captureHash || null,
      resolved: resolutions.filter(item => item.status === "resolved").length,
      total: resolutions.length, resolutions,
      nextAction: "Aporta una captura ampliada de las cartas indicadas o corrige sus campos observados; no se inventaron IDs."
    };
  }
  const players = [];
  for (const resolution of resolutions) {
    const player = await dependencies.getPlayer(resolution.match.renderzId);
    const build = optimizePlayerBuild(player, dependencies, {
      slot: resolution.observation.slot, mode,
      rank: resolution.match.inferredRank, training: Number(resolution.observation.training)
    });
    players.push({
      renderzId: resolution.match.renderzId, slot: resolution.observation.slot,
      rank: resolution.match.inferredRank, training: Number(resolution.observation.training),
      skills: build.simulated.skillUpgrades
    });
  }
  const squad = {
    mode, formation: input.formation || null,
    source: { type: "screenshot", captureHash: input.captureHash || null }, players
  };
  const analysis = await analyzeSquad(squad, dependencies);
  const recommendations = input.recommendations === false ? null : await autoRecommendChanges({
    squad, market: input.market || { auctionable: true, maxSlots: 3 }, limit: input.limit || 10
  }, dependencies);
  return {
    status: "analyzed", mode, captureHash: input.captureHash || null,
    resolutionConfidence: Math.round(resolutions.reduce((sum, item) => sum + item.confidence, 0) / resolutions.length * 1000) / 1000,
    resolutions, squad, analysis, recommendations,
    screenshotAssumptions: [
      "Nombre, OVR, puesto, rango y entrenamiento se tratan como observaciones visuales y se validan contra RenderZ.",
      "Los skill points no aparecen normalmente en el XI: se usa la build válida que maximiza el rol y modo, identificada como optimizada.",
      "Si dos cartas no equivalentes encajan, el proceso se detiene y solicita una ampliación en vez de escoger arbitrariamente."
    ]
  };
}

export function uidResolution(uid) {
  const value = String(uid || "");
  if (!/^\d{15,22}$/.test(value)) throw new Error("UID inválido: se esperan 15-22 dígitos.");
  return {
    status: "needs_verification", uid: value,
    reason: "NO_PUBLIC_SQUAD_ENDPOINT",
    detail: "RenderZ permite vincular el UID con un código dentro de una cuenta, pero no publica una API anónima de plantillas.",
    verificationFlow: ["Crear challenge de un solo uso", "Cambiar temporalmente el nombre de la plantilla activa al código", "Verificar y capturar el snapshot", "Restaurar el nombre"],
    acceptedFallbacks: ["renderz_link", "screenshot", "manual"],
    safety: "No se solicita contraseña de EA y nunca se inventa una plantilla para un UID no resuelto."
  };
}

function balancedValue(source, start, open = "{", close = "}") {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (["\"", "'", "`"].includes(character)) quote = character;
    else if (character === open) depth++;
    else if (character === close && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error("Snapshot de plantilla RenderZ truncado.");
}

export function parseRenderzSquadHtml(html) {
  const marker = "data:{squad:";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error("RenderZ no incluyó un snapshot público de plantilla.");
  const start = html.indexOf("{", markerIndex + marker.length);
  const literal = balancedValue(html, start).replaceAll("void 0", "undefined");
  return vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 500 });
}

function parseRenderzFormationsHtml(html) {
  const marker = "formations:[";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error("RenderZ no incluyó el catálogo de formaciones.");
  const start = html.indexOf("[", markerIndex);
  const literal = balancedValue(html, start, "[", "]").replaceAll("void 0", "undefined");
  return vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 500 });
}

export async function fetchRenderzSquad(squadId, fetchImpl = fetch) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(String(squadId))) throw new Error("squadId RenderZ inválido.");
  const response = await fetchImpl(`https://renderz.app/24/squadbuilder/${squadId}`, { headers: { accept: "text/html", "user-agent": "FuguRenderzModel/1.0" } });
  if (!response.ok) throw new Error(`RenderZ respondió ${response.status} al pedir la plantilla.`);
  const html = await response.text();
  const squad = parseRenderzSquadHtml(html);
  const formation = parseRenderzFormationsHtml(html).find(item => Number(item.id) === Number(squad.formationId));
  if (!formation) throw new Error(`RenderZ no describió la formación ${squad.formationId}.`);
  const slots = new Map(formation.positions.map(position => [Number(position.id), position]));
  return {
    source: { type: "renderz_link", value: String(squadId), isGameAccountSquad: Boolean(squad.isGameAccountSquad) },
    squadId: squad.squadId, name: squad.name, username: squad.username, formationId: squad.formationId,
    formation: { id: formation.id, name: formation.name }, rating: squad.rating,
    players: (squad.players || []).map(player => ({
      renderzId: String(player.id), slot: slots.get(Number(player.squadPosition))?.name || player.position,
      naturalPosition: player.position, slotType: slots.get(Number(player.squadPosition))?.slotType || null,
      rank: Number(player.rank || 0), training: Number(player.level || 0),
      skills: (player.skillUpgrades || []).map(skill => ({ id: Number(skill.id), level: Number(skill.level) })),
      squadPosition: player.squadPosition, starter: slots.has(Number(player.squadPosition)),
      cardName: player.cardName || player.name, observedPlayStyles: player.playStyles || []
    }))
  };
}

export function scoringModel() {
  return { version: MODEL_VERSION, modes: MODES, roleProfiles: ROLE_PROFILES, playStyleRules: PLAYSTYLE_RULES, playStyleAliases: PLAYSTYLE_ALIASES };
}
