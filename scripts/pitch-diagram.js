import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { CACHE, ROOT } from "./bltr.js";

const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "data/formations.json"), "utf8"));

export const SLOT_TO_ES = {
  GK: "POR", LB: "LI", RB: "LD", CB: "DFC", LWB: "CAI", RWB: "CAD",
  CDM: "MCD", CM: "MC", CAM: "MCO", LM: "MI", RM: "MD",
  LW: "EI", RW: "ED", ST: "DC", CF: "SD"
};

export const ES_TO_SLOT = {
  POR: "GK", LI: "LB", LD: "RB", DFC: "CB", CAI: "LWB", CAD: "RWB",
  MCD: "CDM", MC: "CM", MCO: "CAM", MI: "LM", MD: "RM",
  EI: "LW", ED: "RW", DC: "ST", DEL: "ST", SD: "CF"
};

const SLOT_BAND = {
  GK: "gk",
  LB: "wbL", LWB: "wbL",
  RB: "wbR", RWB: "wbR",
  CB: "cb",
  CDM: "cdm",
  CM: "cm", LM: "midL", RM: "midR",
  CAM: "cam",
  LW: "wingL", RW: "wingR",
  CF: "cf", ST: "st"
};

const BAND_Y = {
  gk: 0.90, wbL: 0.73, wbR: 0.73, cb: 0.74,
  cdm: 0.56, cm: 0.45, midL: 0.44, midR: 0.44,
  cam: 0.32, wingL: 0.16, wingR: 0.16, cf: 0.14, st: 0.10
};

const BAND_X = {
  gk: [0.50, 0.50],
  wbL: [0.11, 0.11],
  wbR: [0.89, 0.89],
  cb: [0.32, 0.68],
  cdm: [0.34, 0.66],
  cm: [0.28, 0.72],
  midL: [0.12, 0.12],
  midR: [0.88, 0.88],
  cam: [0.28, 0.72],
  wingL: [0.14, 0.14],
  wingR: [0.86, 0.86],
  cf: [0.38, 0.62],
  st: [0.38, 0.62]
};

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

const FONT = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 14, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 4, 4],
  "'": [4, 4, 0, 0, 0, 0, 0],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [14, 17, 1, 6, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [14, 17, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 17, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 19, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [1, 1, 1, 1, 17, 17, 14],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 17, 25, 21, 19, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [14, 17, 16, 14, 1, 17, 14],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "?": [14, 17, 1, 2, 4, 0, 4]
};

for (const letter of Object.keys(FONT)) {
  if (letter.length === 1 && letter >= "A" && letter <= "Z") FONT[letter.toLowerCase()] = FONT[letter];
}

export function normalizeSlot(value) {
  const upper = String(value || "").toUpperCase().trim();
  return ES_TO_SLOT[upper] || (SLOT_TO_ES[upper] ? upper : upper || null);
}

export function slotLabel(slot) {
  return SLOT_TO_ES[slot] || slot || "";
}

export function latinize(value) {
  return String(value || "").normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/ø/gi, "o").replace(/æ/gi, "ae").replace(/ł/gi, "l").replace(/đ/gi, "d");
}

function displayName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  const picked = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || "?");
  return picked.length > 11 ? `${picked.slice(0, 10)}.` : picked;
}

function spread(count, left, right) {
  if (count <= 0) return [];
  if (count === 1) return [(left + right) / 2];
  return Array.from({ length: count }, (_, index) => left + (index / (count - 1)) * (right - left));
}

const FORMATION_WORDS = {
  ANCHO: "WIDE", ESTRECHO: "NARROW", NARROW: "NARROW", WIDE: "WIDE",
  DEFENSIVO: "DEFEND", DEFEND: "DEFEND", OFENSIVO: "ATTACK", ATTACK: "ATTACK",
  HOLDING: "HOLDING", PIVOTE: "HOLDING", DIAMOND: "DIAMOND", DIAMANTE: "DIAMOND",
  FLAT: "FLAT", PLANO: "FLAT"
};

function normalizeFormationName(value) {
  let text = latinize(String(value || "")).toUpperCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/FALSO\s*9/g, "FALSE 9");
  text = text.replace(/\b(H2H|VSA|MANAGER|META)\b/g, " ");
  const tokens = text.split(" ").map(token => FORMATION_WORDS[token] || token).filter(Boolean);
  return tokens.join(" ").trim();
}

export function listFormations() {
  return CATALOG.formations.map(item => ({ id: item.id, name: item.name }));
}

export function findFormation(value) {
  if (value && typeof value === "object" && Array.isArray(value.positions)) return value;
  const wanted = normalizeFormationName(value);
  if (!wanted) return null;
  const formations = CATALOG.formations;
  const exact = formations.find(item => item.name === wanted);
  if (exact) return exact;
  const numbered = formations.filter(item => item.name === wanted || item.name.startsWith(`${wanted} `));
  if (numbered.length === 1) return numbered[0];
  if (numbered.length > 1) {
    return numbered.find(item => item.name.endsWith(" WIDE") || item.name.endsWith(" HOLDING")) || numbered[0];
  }
  return formations.find(item => item.name.includes(wanted)) || null;
}

export function requireFormation(value) {
  const found = findFormation(value);
  if (found) return found;
  const names = CATALOG.formations.map(item => item.name).join(", ");
  throw new Error(`Formación no está en el catálogo RenderZ del Squadbuilder: ${value || "(vacía)"}. Disponibles: ${names}`);
}

function roleGroup(slot) {
  const normalized = normalizeSlot(slot);
  return {
    GK: "gk", CB: "cb",
    LB: "fbL", LWB: "fbL", RB: "fbR", RWB: "fbR",
    CDM: "mid", CM: "mid", CAM: "mid",
    LM: "wL", LW: "wL", RM: "wR", RW: "wR",
    CF: "st", ST: "st"
  }[normalized] || "mid";
}

function toPoint(hole) {
  return { x: Number(hole.x) / 100, y: Number(hole.y) / 100, slotType: hole.slotType, holeId: hole.id };
}

function layoutByBands(players) {
  const groups = new Map();
  players.forEach((player, index) => {
    const slot = normalizeSlot(player.slot) || "CM";
    const band = SLOT_BAND[slot] || "cm";
    if (!groups.has(band)) groups.set(band, []);
    groups.get(band).push({ ...player, slot, index });
  });
  const placed = [];
  for (const [band, group] of groups) {
    const range = BAND_X[band] || [0.3, 0.7];
    const xs = spread(group.length, range[0], range[1]);
    group.forEach((player, index) => {
      placed.push({
        ...player,
        x: xs[index],
        y: BAND_Y[band] ?? 0.45,
        label: slotLabel(player.slot)
      });
    });
  }
  return placed.sort((left, right) => left.index - right.index);
}

function takeHole(holes, predicate) {
  const index = holes.findIndex(hole => !hole.used && predicate(hole));
  if (index < 0) return null;
  holes[index].used = true;
  return holes[index];
}

export function layoutPlayers(players, formation) {
  const resolved = requireFormation(formation);
  const holes = resolved.positions
    .map(hole => ({ ...hole, used: false }))
    .sort((left, right) => left.x - right.x || left.y - right.y);
  const leftover = [];
  const placed = [];
  players.forEach((player, index) => {
    const slot = normalizeSlot(player.slot) || "CM";
    const hole = takeHole(holes, item => item.name === slot);
    if (!hole) {
      leftover.push({ ...player, slot, index });
      return;
    }
    placed.push({ ...player, slot, index, label: slotLabel(slot), ...toPoint(hole) });
  });
  for (const player of leftover) {
    const group = roleGroup(player.slot);
    const hole = takeHole(holes, item => roleGroup(item.name) === group)
      || takeHole(holes, () => true);
    if (!hole) continue;
    placed.push({ ...player, label: slotLabel(player.slot), ...toPoint(hole) });
  }
  for (const hole of holes.filter(item => !item.used)) {
    placed.push({
      name: "", slot: hole.name, empty: true, label: slotLabel(hole.name), ...toPoint(hole)
    });
  }
  return placed.sort((left, right) => (left.y - right.y) || (left.x - right.x));
}

function linePlayers(placed) {
  const lines = new Map();
  for (const player of placed) {
    const key = Math.round(player.y * 20);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(player);
  }
  return [...lines.entries()].sort((left, right) => left[0] - right[0])
    .map(([, group]) => group.sort((left, right) => left.x - right.x));
}

function padCenter(text, width) {
  const value = String(text);
  if (value.length >= width) return value.slice(0, width);
  const left = Math.floor((width - value.length) / 2);
  return `${" ".repeat(left)}${value}${" ".repeat(width - value.length - left)}`;
}

export function asciiPitch({ formation, players, notes = [] }) {
  const placed = layoutPlayers(players, formation).filter(player => !player.empty);
  const lines = linePlayers(placed);
  const cell = 18;
  const width = Math.max(52, lines.reduce((max, line) => Math.max(max, line.length * cell), 0));
  const rows = [];
  if (formation) rows.push(padCenter(formation, width), "");
  for (const line of lines) {
    const names = line.map(player => padCenter(player.name, cell)).join("");
    const slots = line.map(player => padCenter(player.label, cell)).join("");
    const offset = Math.floor((width - names.length) / 2);
    const pad = " ".repeat(Math.max(0, offset));
    rows.push(`${pad}${names}`.trimEnd(), `${pad}${slots}`.trimEnd(), "");
  }
  for (const note of notes) rows.push(String(note));
  return rows.join("\n").replace(/\s+\n/g, "\n").trimEnd();
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const dest = y * (width * 4 + 1);
    raw[dest] = 0;
    rgba.copy(raw, dest + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function setPixel(rgba, width, height, x, y, color) {
  const px = x | 0;
  const py = y | 0;
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  const alpha = color[3] / 255;
  if (alpha >= 1) {
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = 255;
    return;
  }
  rgba[offset] = Math.round(color[0] * alpha + rgba[offset] * (1 - alpha));
  rgba[offset + 1] = Math.round(color[1] * alpha + rgba[offset + 1] * (1 - alpha));
  rgba[offset + 2] = Math.round(color[2] * alpha + rgba[offset + 2] * (1 - alpha));
  rgba[offset + 3] = 255;
}

function fillRect(rgba, width, height, x, y, w, h, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.ceil(x + w));
  const y1 = Math.min(height, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) setPixel(rgba, width, height, px, py, color);
  }
}

function fillCircle(rgba, width, height, cx, cy, radius, color) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(width, Math.ceil(cx + radius));
  const y1 = Math.min(height, Math.ceil(cy + radius));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPixel(rgba, width, height, px, py, color);
    }
  }
}

function strokeLine(rgba, width, height, x0, y0, x1, y1, color, thickness = 3) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.hypot(dx, dy) | 0);
  for (let step = 0; step <= steps; step++) {
    const x = x0 + (dx * step) / steps;
    const y = y0 + (dy * step) / steps;
    fillCircle(rgba, width, height, x, y, thickness / 2, color);
  }
}

function strokeRect(rgba, width, height, x, y, w, h, color, thickness = 3) {
  strokeLine(rgba, width, height, x, y, x + w, y, color, thickness);
  strokeLine(rgba, width, height, x + w, y, x + w, y + h, color, thickness);
  strokeLine(rgba, width, height, x + w, y + h, x, y + h, color, thickness);
  strokeLine(rgba, width, height, x, y + h, x, y, color, thickness);
}

function strokeCircle(rgba, width, height, cx, cy, radius, color, thickness = 3) {
  const steps = Math.max(32, Math.round(radius * 6));
  for (let step = 0; step < steps; step++) {
    const a0 = (step / steps) * Math.PI * 2;
    const a1 = ((step + 1) / steps) * Math.PI * 2;
    strokeLine(
      rgba, width, height,
      cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius,
      cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius,
      color, thickness
    );
  }
}

function measureText(text, scale) {
  return String(text).length * (5 * scale + scale);
}

function drawChar(rgba, width, height, ch, x, y, scale, color) {
  const glyph = FONT[ch] || FONT["?"];
  if (!glyph) return;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (glyph[row] & (1 << (4 - col))) {
        fillRect(rgba, width, height, x + col * scale, y + row * scale, scale, scale, color);
      }
    }
  }
}

function drawText(rgba, width, height, text, x, y, scale, color, align = "left") {
  const value = latinize(text);
  let cursor = x;
  if (align === "center") cursor = x - measureText(value, scale) / 2;
  if (align === "right") cursor = x - measureText(value, scale);
  for (const ch of value) {
    drawChar(rgba, width, height, FONT[ch] ? ch : "?", cursor, y, scale, color);
    cursor += 5 * scale + scale;
  }
}

function roundRect(rgba, width, height, x, y, w, h, radius, color) {
  fillRect(rgba, width, height, x + radius, y, w - radius * 2, h, color);
  fillRect(rgba, width, height, x, y + radius, w, h - radius * 2, color);
  fillCircle(rgba, width, height, x + radius, y + radius, radius, color);
  fillCircle(rgba, width, height, x + w - radius, y + radius, radius, color);
  fillCircle(rgba, width, height, x + radius, y + h - radius, radius, color);
  fillCircle(rgba, width, height, x + w - radius, y + h - radius, radius, color);
}

function drawPitchMarkings(rgba, width, height, field) {
  const white = [245, 248, 242, 230];
  const { x, y, w, h } = field;
  strokeRect(rgba, width, height, x, y, w, h, white, 4);
  const midY = y + h / 2;
  strokeLine(rgba, width, height, x, midY, x + w, midY, white, 4);
  strokeCircle(rgba, width, height, x + w / 2, midY, h * 0.09, white, 4);
  fillCircle(rgba, width, height, x + w / 2, midY, 5, white);
  const boxW = w * 0.62;
  const boxH = h * 0.165;
  const boxX = x + (w - boxW) / 2;
  strokeRect(rgba, width, height, boxX, y, boxW, boxH, white, 4);
  strokeRect(rgba, width, height, boxX, y + h - boxH, boxW, boxH, white, 4);
  const sixW = w * 0.32;
  const sixH = h * 0.07;
  const sixX = x + (w - sixW) / 2;
  strokeRect(rgba, width, height, sixX, y, sixW, sixH, white, 3);
  strokeRect(rgba, width, height, sixX, y + h - sixH, sixW, sixH, white, 3);
  const goalW = w * 0.18;
  const goalX = x + (w - goalW) / 2;
  strokeRect(rgba, width, height, goalX, y - 8, goalW, 8, white, 3);
  strokeRect(rgba, width, height, goalX, y + h, goalW, 8, white, 3);
}

function cardColors(highlight) {
  if (highlight === "in") return { fill: [18, 92, 58, 245], border: [120, 230, 160, 255], name: [255, 255, 255, 255] };
  if (highlight === "out") return { fill: [70, 45, 45, 230], border: [210, 110, 110, 255], name: [235, 210, 210, 255] };
  if (highlight === "swap") return { fill: [92, 64, 18, 245], border: [240, 190, 80, 255], name: [255, 250, 230, 255] };
  return { fill: [16, 32, 24, 235], border: [230, 205, 110, 255], name: [255, 255, 255, 255] };
}

export function renderPitchPng({ formation, title, players, notes = [] }) {
  const width = 720;
  const height = 1180;
  const rgba = Buffer.alloc(width * height * 4, 255);
  const header = 72;
  const footer = notes.length ? 28 + notes.length * 26 : 36;
  fillRect(rgba, width, height, 0, 0, width, height, [12, 28, 18, 255]);
  const stripeH = 36;
  for (let y = header; y < height - footer; y += stripeH) {
    const even = Math.floor((y - header) / stripeH) % 2 === 0;
    fillRect(rgba, width, height, 0, y, width, stripeH, even ? [34, 122, 58, 255] : [28, 108, 50, 255]);
  }
  fillRect(rgba, width, height, 0, 0, width, header, [10, 22, 16, 255]);
  fillRect(rgba, width, height, 0, height - footer, width, footer, [10, 22, 16, 255]);
  const heading = title || formation || "XI";
  drawText(rgba, width, height, heading, width / 2, 22, 3, [245, 236, 180, 255], "center");
  if (title && formation && title !== formation) {
    drawText(rgba, width, height, formation, width / 2, 48, 2, [180, 210, 170, 255], "center");
  }
  const field = { x: 36, y: header + 18, w: width - 72, h: height - header - footer - 36 };
  drawPitchMarkings(rgba, width, height, field);
  const placed = layoutPlayers(players, formation);
  const cardW = 128;
  const cardH = 74;
  for (const player of placed) {
    const cx = field.x + player.x * field.w;
    const cy = field.y + player.y * field.h;
    const x = cx - cardW / 2;
    const y = cy - cardH / 2;
    const colors = player.empty
      ? { fill: [20, 70, 38, 180], border: [200, 220, 200, 160], name: [220, 235, 220, 220] }
      : cardColors(player.highlight);
    roundRect(rgba, width, height, x + 3, y + 5, cardW, cardH, 12, [0, 0, 0, 70]);
    roundRect(rgba, width, height, x, y, cardW, cardH, 12, colors.fill);
    strokeRect(rgba, width, height, x + 1, y + 1, cardW - 2, cardH - 2, colors.border, 3);
    const name = player.empty ? player.label : displayName(player.name);
    drawText(rgba, width, height, name, cx, y + 16, 2, colors.name, "center");
    if (!player.empty) {
      drawText(rgba, width, height, player.label, cx, y + 40, 2, [230, 205, 110, 255], "center");
    }
    if (!player.empty && player.ovr != null) {
      drawText(rgba, width, height, String(player.ovr), x + cardW - 10, y + 8, 2, [210, 230, 215, 255], "right");
    }
  }
  notes.forEach((note, index) => {
    drawText(rgba, width, height, note, width / 2, height - footer + 10 + index * 26, 2, [220, 230, 215, 255], "center");
  });
  return encodePng(width, height, rgba);
}

export function extractLineup(input = {}) {
  const analysis = input.analysis && typeof input.analysis === "object" ? input.analysis : {};
  const rawPlayers = input.players || analysis.players || [];
  const players = rawPlayers
    .filter(player => player && player.starter !== false)
    .slice(0, 11)
    .map((player, index) => ({
      name: player.name || player.cardName || player.player || "",
      slot: player.slot,
      ovr: player.displayedOvr ?? player.ovr,
      highlight: player.highlight,
      starter: player.starter
    }));
  if (!players.length) throw new Error("Indica al menos un jugador con name y slot para el campo.");
  if (players.some(player => !player.name || !player.slot)) {
    throw new Error("Cada jugador del campo necesita name y slot observados; no se inventan cartas.");
  }
  const formation = input.formation || analysis.formation || null;
  const resolved = requireFormation(formation);
  const notes = [...(input.notes || []), ...(input.bench || []).map(item => {
    if (typeof item === "string") return item;
    return [item.name, item.note].filter(Boolean).join(" — ");
  })];
  return {
    formation: resolved.name,
    title: input.title || null,
    notes,
    players
  };
}

export async function renderLineupPitch(input = {}) {
  const lineup = extractLineup(input);
  const ascii = asciiPitch(lineup);
  const png = renderPitchPng(lineup);
  const out = input.out === false || input.out === ""
    ? null
    : path.resolve(String(input.out || path.join(CACHE, "lineup.png")));
  if (out) {
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, png);
  }
  const matched = findFormation(lineup.formation);
  return {
    formation: lineup.formation,
    formationMatch: matched?.name || null,
    title: lineup.title,
    players: layoutPlayers(lineup.players, lineup.formation)
      .filter(player => !player.empty)
      .map(player => ({
        name: player.name, slot: player.slot, label: player.label,
        x: player.x, y: player.y, slotType: player.slotType || null
      })),
    ascii,
    pngPath: out,
    bytes: png.length,
    imageBase64: input.base64 === true ? png.toString("base64") : undefined,
    png
  };
}
