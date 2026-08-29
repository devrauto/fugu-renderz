import fs from "node:fs/promises";
import { loadPositionModifiers, searchPlayers } from "./fugu-service.js";
import { runTool } from "./mcp-server.js";

const COMMANDS = {
  search: { tool: "search_players" },
  player: { tool: "get_player", positional: ["renderzId"] },
  simulate: { tool: "simulate_player", positional: ["renderzId"] },
  analyze: { tool: "analyze_squad" },
  scoring: { tool: "get_scoring_model" },
  "import-squad": { tool: "import_renderz_squad", positional: ["squadId"] },
  "analyze-squad": { tool: "analyze_renderz_squad", positional: ["squadId"] },
  recommend: { tool: "recommend_changes" },
  "auto-recommend": { tool: "auto_recommend_changes" },
  inspect: { tool: "inspect_squad_screenshot", positional: ["imagePath"] },
  screenshot: { tool: "analyze_squad_screenshot" },
  uid: { tool: "resolve_fcm_uid", positional: ["uid"] },
  club: { tool: "get_club" },
  "club-import": { tool: "import_club_cards" },
  "club-analyze": { tool: "analyze_club" }
};

const HELP = `Uso: fugu <comando> [argumentos]

Pensado para la VM de Grok Bot (/workspace/fugu-renderz). JSON por stdout. No inventes cartas.

  doctor                         Comprueba Node, tabla de entrenamiento y RenderZ
  search --text Neymar [--auctionable false --positions ST --limit 5 --cursor ...]
  player <renderzId>
  simulate <renderzId> [--rank 5 --training 30 --skills 30021.2]
  analyze --json squad.json      o JSON por stdin (mode + players)
  analyze-squad <squadId> --mode h2h
  import-squad <squadId>
  recommend --json payload.json
  auto-recommend --json payload.json
  screenshot --json observations.json
  inspect <ruta-imagen>
  uid <uid>
  club
  club-import --json observations.json
  club-analyze [--mode h2h]
  scoring

Flags: --json archivo  fusiona un objeto JSON. Las flags pisan el archivo.
Los objetos/arrays también se pueden pasar como JSON literal: --players '[...]'
`;

function coerce(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    return JSON.parse(value);
  }
  return value;
}

function parseArgv(argv) {
  const args = {};
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = coerce(next);
      index++;
    }
  }
  return { args, positional };
}

async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : null;
}

async function doctor() {
  const modifiers = await loadPositionModifiers();
  const sample = await searchPlayers({ text: "Neymar", limit: 1, auctionable: false });
  return {
    ok: true,
    node: process.version,
    modifierKeys: Object.keys(modifiers).length,
    renderz: sample.players[0]?.name || sample.players[0]?.cardName || true
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "-h" || command === "--help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "doctor") {
    process.stdout.write(`${JSON.stringify(await doctor(), null, 2)}\n`);
    return;
  }
  const spec = COMMANDS[command];
  if (!spec) {
    process.stderr.write(`Comando desconocido: ${command}\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  const { args, positional } = parseArgv(rest);
  const fromFile = args.json ? JSON.parse(await fs.readFile(args.json, "utf8")) : {};
  delete args.json;
  const fromStdin = await readStdinJson();
  const payload = { ...fromFile, ...(fromStdin || {}), ...args };
  (spec.positional || []).forEach((name, index) => {
    if (positional[index] !== undefined && payload[name] === undefined) payload[name] = positional[index];
  });
  const value = await runTool(spec.tool, payload);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
