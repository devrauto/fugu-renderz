import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFormation, layoutPlayers, listFormations, renderLineupPitch } from "./pitch-diagram.js";

const formations = listFormations();
assert.equal(formations.length, 29);
assert.equal(findFormation("4-3-3 HOLDING")?.name, "4-3-3 HOLDING");
assert.equal(findFormation("4-2-3-1 ancho")?.name, "4-2-3-1 WIDE");
assert.equal(findFormation("4-3-3")?.name, "4-3-3");

const holding = findFormation("4-3-3 HOLDING");
const gk = holding.positions.find(item => item.name === "GK");
const st = holding.positions.find(item => item.name === "ST");
assert.equal(gk.x, 50);
assert.equal(gk.y, 90);
assert.equal(st.x, 50);
assert.equal(st.y, 13);

const xi = [
  { name: "Vini", slot: "EI" },
  { name: "Eusébio", slot: "DC" },
  { name: "Bale", slot: "ED" },
  { name: "Charlton", slot: "MCO" },
  { name: "Rodri", slot: "MCD" },
  { name: "Neymar", slot: "MCO" },
  { name: "Cucurella", slot: "LI" },
  { name: "Lúcio", slot: "DFC" },
  { name: "Desailly", slot: "DFC" },
  { name: "Lahm", slot: "LD" },
  { name: "Čech", slot: "POR" }
];
const placed = layoutPlayers(xi, "4-3-3 HOLDING").filter(player => !player.empty);
assert.equal(placed.length, 11);
const cech = placed.find(player => player.name === "Čech");
const eusebio = placed.find(player => player.name === "Eusébio");
const vini = placed.find(player => player.name === "Vini");
const bale = placed.find(player => player.name === "Bale");
assert.equal(cech.y, 0.9);
assert.equal(eusebio.x, 0.5);
assert.ok(vini.x < eusebio.x);
assert.ok(bale.x > eusebio.x);
const rodri = placed.find(player => player.name === "Rodri");
assert.equal(rodri.slot, "CDM");

const out = path.join(os.tmpdir(), `fugu-pitch-${process.pid}.png`);
const result = await renderLineupPitch({
  formation: "4-3-3 HOLDING",
  title: "XI",
  players: xi,
  notes: ["Gullit sale. Neymar entra de segundo MCO."],
  out
});
assert.equal(result.formationMatch, "4-3-3 HOLDING");
assert.match(result.ascii, /Vini/);
assert.match(result.ascii, /POR/);
assert.equal(fs.readFileSync(out).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
assert.ok(result.bytes > 2000);
fs.unlinkSync(out);

let failed = false;
try {
  await renderLineupPitch({ players: [{ slot: "ST" }] });
} catch (error) {
  failed = /name y slot/.test(error.message);
}
assert.equal(failed, true);

console.log(JSON.stringify({
  ok: true,
  formations: formations.length,
  formation: result.formationMatch,
  pngBytes: result.bytes
}));
