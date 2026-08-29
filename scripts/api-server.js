import http from "node:http";
import { URL } from "node:url";
import { evaluateTarget } from "./bltr.js";
import {
  engineDependencies,
  getBasePlayer,
  getBrowserTarget,
  loadPositionModifiers,
  searchPlayers
} from "./fugu-service.js";
import { modelDescription, parseSkills, simulatePlayer } from "./renderz-model.js";
import { analyzeSquad, autoRecommendChanges, fetchRenderzSquad, recommendChanges, resolveScreenshotSquad, scoringModel, uidResolution } from "./squad-analysis.js";

const PORT = Number(process.env.PORT || 8787);
const MAX_RANK = 5;
const MAX_TRAINING = 30;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  response.end(JSON.stringify(body, null, 2));
}

async function readJson(request, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("El cuerpo JSON supera el límite permitido.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new Error("JSON inválido."); }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Valor fuera de rango (${min}-${max}).`);
  return parsed;
}

function buildRenderzUrl(playerId, query) {
  if (!/^\d+$/.test(playerId)) throw new Error("playerId inválido.");
  const rank = boundedInteger(query.get("rank"), MAX_RANK, 0, MAX_RANK);
  const training = boundedInteger(query.get("training"), MAX_TRAINING, 0, MAX_TRAINING);
  const skills = query.get("skills") || "";
  if (skills && !/^\d+\.[0-9]+(?:-\d+\.[0-9]+)*$/.test(skills)) throw new Error("Formato skills inválido.");
  const url = new URL(`https://renderz.app/24/player/${playerId}`);
  url.searchParams.set("level", String(training));
  url.searchParams.set("rankUp", String(rank));
  if (skills) url.searchParams.set("skillUpgrades", skills);
  return { url: url.toString(), rank, training, skills };
}

function firstNumberAfter(text, labels) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*\\n\\s*(\\d+)`, "i"));
    if (match) return Number(match[1]);
  }
  return null;
}

function lastNumberAfter(text, labels) {
  for (const label of labels) {
    const matches = [...text.matchAll(new RegExp(`(?:^|\\n)${label}\\s*\\n\\s*(\\d+)`, "gim"))];
    if (matches.length) return Number(matches.at(-1)[1]);
  }
  return null;
}

function parseDetailedStats(text, position) {
  const labels = position === "GK" ? {
    gkd: ["Estirada POR", "GK Diving"],
    gkp: ["Colocación POR", "GK Positioning"],
    han: ["Paradas del POR", "Handling"],
    ref: ["Reflejos del POR", "Reflexes"],
    gkk: ["Patada del POR", "GK Kicking", "Kicking"],
    jmp: ["Saltos", "Jumping"], lpa: ["Pases largos", "Long Passing"],
    rea: ["Reacciones", "Reactions"], agi: ["Agilidad", "Agility"],
    spd: ["Vel\\. esprint", "Sprint Speed"], str: ["Fuerza", "Strength"]
  } : {
    acc: ["Aceleración", "Acceleration"], spd: ["Vel\\. esprint", "Sprint Speed"],
    fin: ["Finalización", "Finishing"], lsa: ["Tiro lejano", "Long Shot"],
    sho: ["Potencia de tiro", "Shot Power"], pos: ["Posicionamiento", "Positioning"],
    vol: ["Volea", "Volleys"], pen: ["Penaltis", "Penalties"],
    spa: ["Pases cortos", "Short Passing"], lpa: ["Pases largos", "Long Passing"],
    vis: ["Visión", "Vision"], cro: ["Centros", "Crossing"], cur: ["Efecto", "Curve"],
    frk: ["Tiro de falta", "Free Kick"], dri: ["Regates", "Dribbling"],
    bal: ["Equilibrio", "Balance"], agi: ["Agilidad", "Agility"],
    rea: ["Reacciones", "Reactions"], bac: ["Control del balón", "Ball Control"],
    mrk: ["Marcaje", "Marking"], stt: ["Entrada normal", "Standing Tackle"],
    slt: ["Entrada agresiva", "Sliding Tackle"], awr: ["Concentración", "Awareness", "Interceptions"],
    hea: ["Cabezazos", "Heading"], str: ["Fuerza", "Strength"],
    agg: ["Agresividad", "Aggression"], jmp: ["Saltos", "Jumping"],
    sta: ["Resistencia", "Stamina"]
  };
  return Object.fromEntries(Object.entries(labels)
    .map(([attribute, candidates]) => [attribute, lastNumberAfter(text, candidates)])
    .filter(([, value]) => value !== null));
}

function parseRenderz(text, playerId, build) {
  const position = text.match(/(?:POSICI[ÓO]N|POSITION)\s*\n\s*([A-Z]{1,4})/i)?.[1] || null;
  const name = text.match(/(?:Jugadores|Players)\s*\n([^\n]+)\s*\nFC 24\/25/i)?.[1]?.trim() || null;
  const cardBlock = text.match(/(?:Jugador[^\n]*|Player[^\n]*)\s*\n(\d+)\s*\n([A-Z]{1,4})\s*\n([^\n]+)/i);
  const resolvedPosition = position || cardBlock?.[2] || null;
  const faceStats = resolvedPosition === "GK" ? {
    diving: firstNumberAfter(text, ["ESTIRADA", "DIVING"]),
    positioning: firstNumberAfter(text, ["COLOCACIÓN", "GK POSITIONING"]),
    handling: firstNumberAfter(text, ["MANEJO", "HANDLING"]),
    reflexes: firstNumberAfter(text, ["REFLEJOS", "REFLEXES"]),
    kicking: firstNumberAfter(text, ["PATADA", "KICKING"]),
    physical: firstNumberAfter(text, ["FÍSICO", "PHYSICAL"])
  } : {
    pace: firstNumberAfter(text, ["RITMO", "PACE"]),
    shooting: firstNumberAfter(text, ["TIROS", "SHOOTING"]),
    passing: firstNumberAfter(text, ["PASES", "PASSING"]),
    dribbling: firstNumberAfter(text, ["REGATES", "DRIBBLING"]),
    defending: firstNumberAfter(text, ["DEFENSA", "DEFENDING"]),
    physical: firstNumberAfter(text, ["FÍSICO", "PHYSICAL"])
  };
  return {
    source: "renderz",
    playerId,
    url: build.url,
    name,
    card: {
      displayedOvr: cardBlock ? Number(cardBlock[1]) : null,
      position: resolvedPosition,
      cardName: cardBlock?.[3]?.trim() || null,
      rank: build.rank,
      training: build.training,
      skillUpgrades: build.skills ? build.skills.split("-") : []
    },
    stats: faceStats,
    faceStats,
    detailedStats: parseDetailedStats(text, resolvedPosition),
    rawText: text
  };
}

function parseForum(text, reviewId) {
  const stats = {};
  for (const [key, label] of Object.entries({ pace: "PACE", shooting: "SHOOTING", passing: "PASSING", dribbling: "DRIBBLING", defending: "DEFENDING", physical: "PHYSICAL" })) {
    const match = text.match(new RegExp(`(\\d+)\\s*\\n${label}`, "i"));
    stats[key] = match ? Number(match[1]) : null;
  }
  return {
    source: "fcmobileforum",
    reviewId,
    url: `https://www.fcmobileforum.com/player-reviews/${reviewId}`,
    name: text.split("\n").map(x => x.trim()).find((x, i, all) => i > all.indexOf("Inscribirse") && x && !/^(Weak Foot|Skill Moves|Stamina)$/i.test(x)) || null,
    stats,
    rating: Number(text.match(/CLASIFICACI[ÓO]N\s*\n(\d+(?:\.\d+)?)\s*\/\s*10/i)?.[1] || NaN) || null,
    skillBuild: [...text.matchAll(/(\d+)x\s+([A-ZÁÉÍÓÚ ]+)/g)].map(match => ({ points: Number(match[1]), branch: match[2].trim() })),
    rawText: text
  };
}

async function navigateAndText(profileId, targetId, url, expectedTraining = null, isReady = null) {
  try {
    await evaluateTarget(profileId, targetId, `(() => { location.assign(${JSON.stringify(url)}); return true; })()`);
  } catch {
    // La navegación puede destruir el contexto antes de que Runtime.evaluate responda.
  }
  let reloadedForModel = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const state = await evaluateTarget(profileId, targetId, `({href:location.href, ready:document.readyState, text:document.body?.innerText || ""})`);
      const expected = new URL(url);
      const correctPage = state?.href?.includes(expected.pathname) && state.text.length > 300 && state.ready !== "loading";
      const trainingApplied = expectedTraining === null
        || new RegExp(`(?:Training Level|Nivel de entrenamiento)\\s*${expectedTraining}(?:\\D|$)`, "i").test(state.text);
      if (correctPage && trainingApplied && (!isReady || isReady(state.text))) return state.text;
      if (correctPage && expectedTraining !== null && attempt >= 8 && !reloadedForModel) {
        reloadedForModel = true;
        try { await evaluateTarget(profileId, targetId, "location.reload(); true"); } catch { /* cambia el contexto */ }
      }
    } catch { /* transición entre documentos */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("La página no terminó de cargar.");
}

const server = http.createServer(async (request, response) => {
  try {
    if (!["GET", "POST"].includes(request.method)) return json(response, 405, { error: "Method Not Allowed" });
    const requested = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

    if (requested.pathname === "/health") {
      let browser;
      try {
        const target = await getBrowserTarget();
        browser = { available: true, profileId: target.profileId };
      } catch (error) {
        browser = { available: false, reason: error.message };
      }
      return json(response, 200, { ok: true, browser });
    }

    if (request.method === "GET" && requested.pathname === "/api/scoring/model") {
      return json(response, 200, scoringModel());
    }

    if (request.method === "GET" && requested.pathname === "/api/players/search") {
      const positions = (requested.searchParams.get("positions") || "").split(",").map(value => value.trim()).filter(Boolean);
      const numberOrUndefined = name => requested.searchParams.has(name) ? Number(requested.searchParams.get(name)) : undefined;
      return json(response, 200, await searchPlayers({
        text: requested.searchParams.get("text") || undefined,
        positions, limit: numberOrUndefined("limit"), rank: numberOrUndefined("rank"),
        minOvr: numberOrUndefined("minOvr"), maxOvr: numberOrUndefined("maxOvr"),
        maxPrice: numberOrUndefined("maxPrice"), auctionable: requested.searchParams.get("auctionable") !== "false",
        sort: requested.searchParams.get("sort") || "rating", cursor: requested.searchParams.get("cursor") || undefined
      }));
    }

    const uidMatch = request.method === "GET" && requested.pathname.match(/^\/api\/squads\/uid\/(\d+)$/);
    if (uidMatch) return json(response, 200, uidResolution(uidMatch[1]));

    const renderzSquadMatch = request.method === "GET" && requested.pathname.match(/^\/api\/squads\/renderz\/([A-Za-z0-9_-]{10,64})(\/analyze|\/auto-recommend)?$/);
    if (renderzSquadMatch) {
      const snapshot = await fetchRenderzSquad(renderzSquadMatch[1]);
      if (!renderzSquadMatch[2]) return json(response, 200, snapshot);
      const modifiers = await loadPositionModifiers(requested.searchParams.get("refreshModel") === "1");
      const starters = snapshot.players.filter(player => player.starter);
      const squadInput = {
        source: snapshot.source, formation: snapshot.formation.name,
        mode: requested.searchParams.get("mode") || "h2h", players: starters
      };
      const dependencies = engineDependencies(modifiers, { refreshPlayers: requested.searchParams.get("refreshPlayers") === "1" });
      if (renderzSquadMatch[2] === "/auto-recommend") {
        const maxPrice = requested.searchParams.get("maxPrice");
        const result = await autoRecommendChanges({
          squad: squadInput,
          market: {
            auctionable: requested.searchParams.get("auctionable") !== "false",
            maxPrice: maxPrice ? Number(maxPrice) : undefined,
            maxSlots: Number(requested.searchParams.get("maxSlots") || 3),
            maxCandidatesPerSlot: Number(requested.searchParams.get("candidatesPerSlot") || 8),
            rank: Number(requested.searchParams.get("rank") || 5),
            training: Number(requested.searchParams.get("training") || 30)
          },
          limit: Number(requested.searchParams.get("limit") || 10)
        }, dependencies);
        return json(response, 200, { snapshot: { squadId: snapshot.squadId, username: snapshot.username, rating: snapshot.rating }, result });
      }
      const analysis = await analyzeSquad(squadInput, dependencies);
      return json(response, 200, { snapshot: { squadId: snapshot.squadId, username: snapshot.username, rating: snapshot.rating }, analysis });
    }

    if (request.method === "POST" && requested.pathname === "/api/squads/analyze") {
      const body = await readJson(request);
      const modifiers = await loadPositionModifiers(body.refreshModel === true);
      const analysis = await analyzeSquad(body, engineDependencies(modifiers, { refreshPlayers: body.refreshPlayers === true }));
      return json(response, 200, analysis);
    }

    if (request.method === "POST" && requested.pathname === "/api/squads/recommend") {
      const body = await readJson(request);
      const modifiers = await loadPositionModifiers(body.refreshModel === true);
      const result = await recommendChanges(body, engineDependencies(modifiers, { refreshPlayers: body.refreshPlayers === true }));
      return json(response, 200, result);
    }

    if (request.method === "POST" && requested.pathname === "/api/squads/auto-recommend") {
      const body = await readJson(request);
      const modifiers = await loadPositionModifiers(body.refreshModel === true);
      const result = await autoRecommendChanges(body, engineDependencies(modifiers, { refreshPlayers: body.refreshPlayers === true }));
      return json(response, 200, result);
    }

    if (request.method === "POST" && requested.pathname === "/api/squads/screenshot/resolve") {
      const body = await readJson(request);
      const modifiers = await loadPositionModifiers(body.refreshModel === true);
      const result = await resolveScreenshotSquad(body, engineDependencies(modifiers, { refreshPlayers: body.refreshPlayers === true }));
      return json(response, 200, result);
    }

    if (request.method !== "GET") return json(response, 404, { error: "Not Found" });

    if (requested.pathname === "/api/model") {
      const modifiers = await loadPositionModifiers(requested.searchParams.get("refresh") === "1");
      return json(response, 200, modelDescription(Object.keys(modifiers).length));
    }

    const positionModelMatch = requested.pathname.match(/^\/api\/model\/positions(?:\/([A-Z]{2,3}))?$/);
    if (positionModelMatch) {
      const modifiers = await loadPositionModifiers(requested.searchParams.get("refresh") === "1");
      if (!positionModelMatch[1]) {
        return json(response, 200, Object.fromEntries(Object.entries(modifiers).map(([position, levels]) => [position, levels[30]])));
      }
      const position = positionModelMatch[1];
      if (!modifiers[position]) return json(response, 404, { error: `Posición no encontrada: ${position}` });
      const levels = modifiers[position];
      const detailed = Object.fromEntries(Object.entries(levels).map(([level, cumulative]) => {
        const previous = levels[Number(level) - 1] || {};
        const attributes = new Set([...Object.keys(previous), ...Object.keys(cumulative)]);
        const increment = Object.fromEntries([...attributes]
          .map(attribute => [attribute, (cumulative[attribute] || 0) - (previous[attribute] || 0)])
          .filter(([, amount]) => amount !== 0));
        return [level, { cumulative, increment }];
      }));
      return json(response, 200, { position, levels: detailed });
    }

    const playerMatch = requested.pathname.match(/^\/api\/player\/(\d+)$/);
    if (playerMatch) {
      const player = await getBasePlayer(playerMatch[1], requested.searchParams.get("refresh") === "1");
      return json(response, 200, { source: "renderz", player });
    }

    const simulateMatch = requested.pathname.match(/^\/api\/(?:simulate|max)\/(\d+)$/);
    if (simulateMatch) {
      const rank = requested.pathname.startsWith("/api/max/") ? 5 : boundedInteger(requested.searchParams.get("rank"), 5, 0, 5);
      const training = requested.pathname.startsWith("/api/max/") ? 30 : boundedInteger(requested.searchParams.get("training"), 30, 0, 30);
      const skills = parseSkills(requested.searchParams.get("skills") || "");
      const [player, modifiers] = await Promise.all([
        getBasePlayer(simulateMatch[1], requested.searchParams.get("refresh") === "1"),
        loadPositionModifiers(requested.searchParams.get("refreshModel") === "1")
      ]);
      return json(response, 200, simulatePlayer(player, modifiers, { rank, training, skills }));
    }

    const buildMatch = requested.pathname.match(/^\/api\/build\/(\d+)$/);
    if (buildMatch) {
      const { profileId, targetId } = await getBrowserTarget();
      const build = buildRenderzUrl(buildMatch[1], requested.searchParams);
      const basePlayer = await getBasePlayer(buildMatch[1]);
      const text = await navigateAndText(profileId, targetId, build.url, build.training, candidate => {
        const parsed = parseRenderz(candidate, buildMatch[1], build);
        if (parsed.card.displayedOvr !== basePlayer.rating + build.rank) return false;
        if (build.training === 0 && !build.skills) return true;
        return Object.entries(parsed.detailedStats).some(([attribute, value]) => value !== basePlayer.stats[attribute]);
      });
      return json(response, 200, parseRenderz(text, buildMatch[1], build));
    }

    const reviewMatch = requested.pathname.match(/^\/api\/reviews\/(\d+)$/);
    if (reviewMatch) {
      const { profileId, targetId } = await getBrowserTarget();
      const url = `https://www.fcmobileforum.com/player-reviews/${reviewMatch[1]}`;
      const text = await navigateAndText(profileId, targetId, url);
      return json(response, 200, parseForum(text, reviewMatch[1]));
    }

    const combinedMatch = requested.pathname.match(/^\/api\/combined\/(\d+)$/);
    if (combinedMatch) {
      const { profileId, targetId } = await getBrowserTarget();
      const reviewId = requested.searchParams.get("reviewId");
      if (!/^\d+$/.test(reviewId || "")) throw new Error("reviewId es obligatorio.");
      const build = buildRenderzUrl(combinedMatch[1], requested.searchParams);
      const basePlayer = await getBasePlayer(combinedMatch[1]);
      const renderzText = await navigateAndText(profileId, targetId, build.url, build.training, candidate => {
        const parsed = parseRenderz(candidate, combinedMatch[1], build);
        if (parsed.card.displayedOvr !== basePlayer.rating + build.rank) return false;
        if (build.training === 0 && !build.skills) return true;
        return Object.entries(parsed.detailedStats).some(([attribute, value]) => value !== basePlayer.stats[attribute]);
      });
      const renderz = parseRenderz(renderzText, combinedMatch[1], build);
      const forum = parseForum(await navigateAndText(profileId, targetId, `https://www.fcmobileforum.com/player-reviews/${reviewId}`), reviewId);
      const deltas = Object.fromEntries(Object.keys(renderz.stats).map(key => [key, (forum.stats[key] ?? 0) - (renderz.stats[key] ?? 0)]));
      return json(response, 200, { matched: Object.values(deltas).every(value => value === 0), deltas, renderz, forum });
    }

    return json(response, 404, { error: "Not Found", routes: [
      "/health", "/api/model", "/api/model/positions/:position", "/api/player/:playerId", "/api/simulate/:playerId",
      "/api/max/:playerId", "/api/build/:playerId", "/api/reviews/:reviewId",
      "/api/combined/:playerId?reviewId=...", "/api/scoring/model", "/api/squads/uid/:uid",
      "/api/players/search?positions=CB,RB&maxPrice=...&cursor=...",
      "POST /api/squads/analyze", "POST /api/squads/recommend", "POST /api/squads/auto-recommend",
      "POST /api/squads/screenshot/resolve",
      "/api/squads/renderz/:squadId", "/api/squads/renderz/:squadId/analyze?mode=h2h", "/api/squads/renderz/:squadId/auto-recommend?mode=h2h&maxPrice=..."
    ] });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Fugu API: http://127.0.0.1:${PORT}`));
