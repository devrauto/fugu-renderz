import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./bltr.js";
import { optimizePlayerBuild, ROLE_PROFILES } from "./squad-analysis.js";

export const CLUB_FILE = path.join(ROOT, "data", "club.json");

const SPANISH_POSITIONS = {
  EI: "LW", ED: "RW", MI: "LM", MD: "RM", MCD: "CDM", MC: "CM", MCO: "CAM",
  DEL: "ST", SD: "CF", LI: "LB", LD: "RB", DFC: "CB", POR: "GK"
};

export function normalizePosition(value) {
  const upper = String(value || "").toUpperCase().trim();
  return SPANISH_POSITIONS[upper] || upper || null;
}

function normalizedIdentity(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
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

function variantSimilarity(observed, candidate) {
  const left = normalizedIdentity(observed).split(" ").filter(Boolean);
  const right = normalizedIdentity(candidate).split(" ").filter(Boolean);
  if (!left.length || !right.length || left[0] !== right[0]) return 0;
  if (left.join(" ") === right.join(" ")) return 1;
  const overlap = left.filter(token => right.includes(token)).length;
  return overlap / Math.max(left.length, right.length);
}

function cardFingerprint(row) {
  return [normalizedIdentity(row.name), row.rating, row.position,
    (row.playStyles || []).map(style => `${style.name}:${style.level}`).sort().join("|")].join("#");
}

export async function loadClub() {
  try { return JSON.parse(await fs.readFile(CLUB_FILE, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return { players: [], updatedAt: null };
    throw error;
  }
}

export async function saveClub(club) {
  await fs.mkdir(path.dirname(CLUB_FILE), { recursive: true });
  await fs.writeFile(CLUB_FILE, JSON.stringify(club, null, 2));
  return club;
}

export async function resolveOwnedCard(observation, dependencies) {
  const displayed = Number(observation.displayedOvr);
  const position = normalizePosition(observation.naturalPosition);
  if (!observation.name || !Number.isInteger(displayed)) {
    return { status: "invalid", observation, issues: ["se requieren name y displayedOvr"] };
  }
  const search = await dependencies.searchPlayers({
    text: observation.name, auctionable: false, limit: 20,
    minOvr: Math.max(1, displayed - 5), maxOvr: displayed, sort: "rating"
  });
  const ranked = search.players
    .map(candidate => ({ ...candidate, inferredRank: displayed - candidate.rating }))
    .filter(candidate => candidate.inferredRank >= 0 && candidate.inferredRank <= 5)
    .filter(candidate => !position || candidate.position === position)
    .map(candidate => {
      const name = nameSimilarity(observation.name, candidate.name);
      const variant = observation.variant ? variantSimilarity(observation.variant, candidate.variant) : .5;
      return { ...candidate, confidence: Math.round((name * .7 + variant * .3) * 1000) / 1000 };
    })
    .filter(candidate => candidate.confidence >= .45)
    .sort((a, b) => b.confidence - a.confidence || b.rating - a.rating);
  const best = ranked[0];
  const second = ranked[1];
  const equivalent = best && second && cardFingerprint(best) === cardFingerprint(second);
  const ambiguous = !best
    || (second && Math.round((best.confidence - second.confidence) * 1000) < 50 && !equivalent);
  if (ambiguous) {
    return {
      status: "needs_clarification", observation,
      issues: [best ? "varias cartas encajan; indica variant (diseño/evento)" : "ninguna carta coincide con nombre, posición y OVR"],
      candidates: ranked.slice(0, 5).map(candidate => ({
        renderzId: candidate.renderzId, name: candidate.name, rating: candidate.rating,
        position: candidate.position, inferredRank: candidate.inferredRank,
        program: candidate.program, variant: candidate.variant, confidence: candidate.confidence
      }))
    };
  }
  return {
    status: "resolved", observation, confidence: best.confidence,
    entry: {
      renderzId: best.renderzId, name: best.name, rating: best.rating, position: best.position,
      rank: best.inferredRank, training: Number(observation.training ?? 0),
      variant: best.variant || null, program: best.program || null,
      locked: Boolean(observation.locked)
    }
  };
}

export function upsertClubPlayers(club, entries, addedAt) {
  for (const entry of entries) {
    const index = club.players.findIndex(player => player.renderzId === entry.renderzId);
    if (index >= 0) {
      const existing = club.players[index];
      const copies = entry.duplicate ? (existing.copies || 1) + 1 : existing.copies || 1;
      club.players[index] = { ...existing, ...entry, copies };
    } else {
      club.players.push({ ...entry, copies: 1, addedAt });
    }
  }
  club.updatedAt = addedAt;
  return club;
}

export async function analyzeClub(club, dependencies, { mode = "h2h" } = {}) {
  if (!club.players.length) throw new Error("El club está vacío: importa cartas primero con import_club_cards.");
  const rows = [];
  for (const member of club.players) {
    const player = await dependencies.getPlayer(member.renderzId);
    const slots = [...new Set([player.position, ...(player.potentialPositions || [])])].filter(slot => ROLE_PROFILES[slot]);
    const perSlot = {};
    let best = null;
    for (const slot of slots) {
      const max = optimizePlayerBuild(player, dependencies, { slot, mode, rank: 5, training: 30 });
      const atCurrent = (member.rank === 5 && member.training === 30) ? max
        : optimizePlayerBuild(player, dependencies, { slot, mode, rank: member.rank ?? 5, training: member.training ?? 30 });
      perSlot[slot] = { current: atCurrent.analysis.score, max: max.analysis.score };
      if (!best || max.analysis.score > best.max) best = { slot, current: atCurrent.analysis.score, max: max.analysis.score };
    }
    rows.push({
      renderzId: member.renderzId, name: member.name, rating: member.rating,
      position: player.position, rank: member.rank, training: member.training,
      locked: Boolean(member.locked), copies: member.copies || 1, variant: member.variant,
      slots: perSlot, bestSlot: best.slot, currentScore: best.current, maxScore: best.max
    });
  }
  rows.sort((a, b) => b.maxScore - a.maxScore);
  const depth = {};
  for (const row of rows) {
    for (const [slot, scores] of Object.entries(row.slots)) {
      (depth[slot] ||= []).push({ renderzId: row.renderzId, name: row.name, max: scores.max, locked: row.locked });
    }
  }
  for (const list of Object.values(depth)) list.sort((a, b) => b.max - a.max);
  const expendable = rows.filter(row => Object.keys(row.slots).every(slot =>
    depth[slot].findIndex(item => item.renderzId === row.renderzId) >= 2
  )).map(row => ({
    renderzId: row.renderzId, name: row.name, bestSlot: row.bestSlot,
    maxScore: row.maxScore, locked: row.locked, copies: row.copies,
    note: row.locked ? "no vendible (bloqueada); libera hueco o úsala de material" : "ni titular ni primer suplente en ningún puesto"
  }));
  const duplicates = rows.filter(row => row.copies > 1).map(row => ({
    renderzId: row.renderzId, name: row.name, copies: row.copies,
    note: "copias exactas: vende las sobrantes salvo que quieras material de rango"
  }));
  return {
    mode, updatedAt: club.updatedAt, playerCount: rows.length,
    roster: rows, depth, expendable, duplicates,
    assumptions: [
      "Los scores usan el modelo heurístico versionado del proyecto con builds de skills optimizadas.",
      "current = con el rango y entrenamiento observados; max = a rango 5 y entrenamiento 30.",
      "El club puede estar incompleto si no se han importado todas las cartas."
    ]
  };
}
