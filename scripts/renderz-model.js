import vm from "node:vm";

export const ATTRIBUTE_FIELDS = [
  "acc", "agg", "awr", "bac", "bal", "cro", "cur", "dri", "fin", "frk", "hea",
  "jmp", "lpa", "lsa", "mrk", "pen", "pos", "rea", "sho", "slt", "spa", "spd",
  "stt", "str", "vis", "vol", "agi", "gkd", "gkk", "gkp", "han", "ref", "sta"
];

export const OUTFIELD_AVERAGE_WEIGHTS = {
  avg1: { acc: 50, spd: 50 },
  avg2: { fin: 35, lsa: 20, sho: 20, pos: 15, vol: 5, pen: 5 },
  avg3: { spa: 30, lpa: 20, vis: 25, cro: 15, cur: 5, frk: 5 },
  avg4: { dri: 25, bac: 25, agi: 25, rea: 15, bal: 10 },
  avg5: { mrk: 25, stt: 20, slt: 20, awr: 20, hea: 15 },
  avg6: { str: 45, agg: 30, jmp: 25 }
};

export const GOALKEEPER_AVERAGE_WEIGHTS = {
  avg1: { gkd: 100 }, avg2: { gkp: 100 }, avg3: { han: 100 },
  avg4: { ref: 100 }, avg5: { gkk: 100 },
  avg6: { rea: 65, agi: 15, spd: 10, str: 10 }
};

export const FACE_STAT_KEYS = {
  outfield: ["pace", "shooting", "passing", "dribbling", "defending", "physical"],
  goalkeeper: ["diving", "positioning", "handling", "reflexes", "kicking", "physical"]
};

export const MAX_TRAINING = 30;

function readVarint(bytes, cursor) {
  let value = 0;
  let shift = 0;
  while (cursor.offset < bytes.length) {
    const byte = bytes[cursor.offset++];
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) return value;
    shift += 7;
    if (shift > 56) throw new Error("Varint protobuf inválido.");
  }
  throw new Error("Protobuf truncado.");
}

function readMessage(bytes, cursor) {
  const length = readVarint(bytes, cursor);
  const end = cursor.offset + length;
  if (end > bytes.length) throw new Error("Mensaje protobuf truncado.");
  const value = bytes.subarray(cursor.offset, end);
  cursor.offset = end;
  return value;
}

function skipField(bytes, cursor, wireType) {
  if (wireType === 0) return void readVarint(bytes, cursor);
  if (wireType === 1) return void (cursor.offset += 8);
  if (wireType === 2) return void readMessage(bytes, cursor);
  if (wireType === 5) return void (cursor.offset += 4);
  throw new Error(`Wire type protobuf no soportado: ${wireType}`);
}

function decodeModifiers(bytes) {
  const cursor = { offset: 0 };
  const modifiers = {};
  while (cursor.offset < bytes.length) {
    const tag = readVarint(bytes, cursor);
    const field = tag >>> 3;
    const wireType = tag & 7;
    const attribute = ATTRIBUTE_FIELDS[field - 1];
    if (attribute && wireType === 0) modifiers[attribute] = readVarint(bytes, cursor);
    else skipField(bytes, cursor, wireType);
  }
  return modifiers;
}

function decodePositionModifier(bytes) {
  const cursor = { offset: 0 };
  const entry = { position: "", level: 0, modifiers: {} };
  while (cursor.offset < bytes.length) {
    const tag = readVarint(bytes, cursor);
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 1 && wireType === 2) entry.position = new TextDecoder().decode(readMessage(bytes, cursor));
    else if (field === 2 && wireType === 0) entry.level = readVarint(bytes, cursor);
    else if (field === 3 && wireType === 2) entry.modifiers = decodeModifiers(readMessage(bytes, cursor));
    else skipField(bytes, cursor, wireType);
  }
  return entry;
}

export function decodePositionModifiers(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const cursor = { offset: 0 };
  const output = {};
  while (cursor.offset < bytes.length) {
    const tag = readVarint(bytes, cursor);
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field !== 1 || wireType !== 2) {
      skipField(bytes, cursor, wireType);
      continue;
    }
    const entry = decodePositionModifier(readMessage(bytes, cursor));
    if (entry.position) (output[entry.position] ||= {})[entry.level] = entry.modifiers;
  }
  return output;
}

function findBalancedObject(source, start) {
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
    if (character === "\"" || character === "'" || character === "`") quote = character;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error("No se pudo aislar el objeto del jugador en la respuesta de RenderZ.");
}

export function parsePlayerFromHtml(html) {
  const marker = "data:{player:";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error("RenderZ no incluyó los datos hidratados del jugador.");
  const objectStart = html.indexOf("{", markerIndex + marker.length);
  const literal = findBalancedObject(html, objectStart).replaceAll("void 0", "undefined");
  return vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 250 });
}

export async function fetchBasePlayer(playerId, fetchImpl = fetch) {
  if (!/^\d+$/.test(String(playerId))) throw new Error("playerId inválido.");
  const response = await fetchImpl(`https://renderz.app/24/player/${playerId}`, {
    headers: { accept: "text/html", "user-agent": "FuguRenderzModel/1.0" }
  });
  if (!response.ok) throw new Error(`RenderZ respondió ${response.status} al pedir el jugador.`);
  return parsePlayerFromHtml(await response.text());
}

export function calculateAverages(stats, position) {
  const weights = position === "GK" ? GOALKEEPER_AVERAGE_WEIGHTS : OUTFIELD_AVERAGE_WEIGHTS;
  const avgStats = {};
  for (const [group, entries] of Object.entries(weights)) {
    let weighted = 0;
    for (const [attribute, weight] of Object.entries(entries)) weighted += (stats[attribute] ?? 0) * weight;
    avgStats[group] = Math.floor(weighted / 100);
  }
  const keys = position === "GK" ? FACE_STAT_KEYS.goalkeeper : FACE_STAT_KEYS.outfield;
  const faceStats = Object.fromEntries(keys.map((key, index) => [key, avgStats[`avg${index + 1}`]]));
  return { avgStats, faceStats, totalAvgStats: Object.values(avgStats).reduce((sum, value) => sum + value, 0) };
}

function addModifiers(stats, modifiers = {}) {
  const output = { ...stats };
  delete output.total;
  for (const [attribute, amount] of Object.entries(modifiers)) output[attribute] = (output[attribute] ?? 0) + amount;
  output.total = Object.values(output).reduce((sum, value) => sum + value, 0);
  return output;
}

function resolveSkill(player, selected) {
  const branch = player.skillsData?.find(item => item.skill.id === selected.id);
  const level = branch?.skill.levels?.find(item => item.id === selected.id && item.level === selected.level);
  if (!branch || !level) throw new Error(`Skill inexistente: ${selected.id}.${selected.level}`);
  return { branch, level };
}

export function parseSkills(value = "") {
  if (!value) return [];
  return String(value).split("-").map(part => {
    const match = part.match(/^(\d+)\.(\d+)$/);
    if (!match) throw new Error(`Skill inválida: ${part}`);
    return { id: Number(match[1]), level: Number(match[2]) };
  });
}

export function simulatePlayer(player, positionModifiers, options = {}) {
  const rank = Number(options.rank ?? 5);
  const training = Number(options.training ?? MAX_TRAINING);
  const selectedSkills = Array.isArray(options.skills) ? options.skills : parseSkills(options.skills);
  if (!Number.isInteger(rank) || rank < 0 || rank > 5) throw new Error("rank debe estar entre 0 y 5.");
  if (!Number.isInteger(training) || training < 0 || training > MAX_TRAINING) {
    throw new Error(`training debe estar entre 0 y ${MAX_TRAINING}.`);
  }
  const spentPoints = selectedSkills.reduce((sum, skill) => sum + skill.level, 0);
  if (new Set(selectedSkills.map(skill => skill.id)).size !== selectedSkills.length) {
    throw new Error("No se puede seleccionar dos veces la misma rama de skill.");
  }
  if (spentPoints > rank) throw new Error(`La build gasta ${spentPoints} puntos, pero el rango ${rank} sólo concede ${rank}.`);

  let stats = addModifiers(player.stats, positionModifiers[player.position]?.[training]);
  const acquired = new Map(selectedSkills.map(skill => [skill.id, skill.level]));
  const skillUpgradedStats = new Set();
  for (const selected of selectedSkills) {
    const { branch, level } = resolveSkill(player, selected);
    if (branch.requirement && (acquired.get(branch.requirement.skillId) ?? 0) < branch.requirement.level) {
      throw new Error(`Skill ${selected.id} requiere ${branch.requirement.skillId}.${branch.requirement.level}.`);
    }
    stats = addModifiers(stats, level.abilityModifiers);
    Object.keys(level.abilityModifiers).forEach(attribute => skillUpgradedStats.add(attribute.toUpperCase()));
  }
  const averages = calculateAverages(stats, player.position);
  return {
    source: { player: "RenderZ HTML base", trainingModel: "RenderZ position-modifier table", calculator: "local" },
    playerId: player.id,
    name: [player.firstName, player.lastName].filter(Boolean).join(" ") || player.cardName,
    cardName: player.cardName,
    position: player.position,
    baseOvr: player.rating,
    displayedOvr: player.rating + rank,
    rank,
    training,
    maxTraining: MAX_TRAINING,
    skillPoints: { available: rank, spent: spentPoints },
    skillUpgrades: selectedSkills,
    skillUpgradedStats: [...skillUpgradedStats],
    stats,
    ...averages
  };
}

export function modelDescription(positionCount = null) {
  return {
    version: 1,
    exact: true,
    positionCount,
    rank: "displayedOvr = baseOvr + rank; rank grants one skill point but does not limit training in FC Mobile 26",
    maxTraining: MAX_TRAINING,
    trainingIsIndependentFromRank: true,
    training: "base attribute + cumulative modifier[position][trainingLevel]",
    skills: "trained attribute + selected skill node abilityModifier",
    rounding: "each face stat is floor(sum(attribute * integerWeight) / 100)",
    outfieldWeights: OUTFIELD_AVERAGE_WEIGHTS,
    goalkeeperWeights: GOALKEEPER_AVERAGE_WEIGHTS
  };
}
