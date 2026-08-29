import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const SEARCH_ENDPOINT = "https://renderz.app/api/search/elasticsearch?v=1&q=";
const SCRAMBLE_KEY = "renderz-search-scramble-v1";
const POSITIONS = new Set(["GK", "CB", "LB", "RB", "LWB", "RWB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "CF", "ST"]);

function encodeQuery(payload) {
  return deflateRawSync(Buffer.from(JSON.stringify(payload))).toString("base64url");
}

function decodeResponse(value) {
  const source = Buffer.from(value, "base64url");
  const rotated = Buffer.from(source.map(byte => ((byte >> 3) | (byte << 5)) & 255));
  if (source.length <= 8 && rotated[0] !== 1) return null;
  if (rotated.length < 4 || rotated[0] !== 1) throw new Error("Respuesta de búsqueda RenderZ desconocida.");
  const seed = (rotated[1] << 8) | rotated[2];
  const key = createHash("sha256").update(`${SCRAMBLE_KEY}:${seed}`).digest();
  const encrypted = rotated.subarray(3);
  const compressed = Buffer.from(encrypted.map((byte, index) => byte ^ key[index % key.length]));
  return JSON.parse(inflateRawSync(compressed).toString("utf8"));
}

function integer(value, fallback, min, max, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} debe estar entre ${min} y ${max}.`);
  return parsed;
}

function escapeQueryText(text) {
  return text.replace(/[+\-=&|><!(){}[\]^"~*?:\\/]/g, character => `\\${character}`);
}

function boundedRating(value, label) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} debe ser un número.`);
  return parsed;
}

function cardVariant(player) {
  const image = String(player.images?.playerCardImage || "").split("?")[0].split("/").at(-1) || "";
  const match = image.match(/^player_\d+_\d+_(.+)_[0-9a-f]{12,}$/i);
  return match?.[1] || player.bindingXml || null;
}

export async function searchRenderzPlayers(options = {}, fetchImpl = fetch) {
  const positions = [...new Set((options.positions || []).map(position => String(position).toUpperCase()))];
  if (positions.some(position => !POSITIONS.has(position))) throw new Error("positions contiene una posición FC Mobile inválida.");
  const limit = integer(options.limit, 10, 1, 40, "limit");
  const rank = integer(options.rank, 5, 0, 5, "rank");
  const must = [];
  if (options.text) {
    const text = String(options.text).trim();
    if (!text || text.length > 100) throw new Error("text debe tener entre 1 y 100 caracteres.");
    must.push({ query_string: { fields: ["cardName", "commonName", "firstName", "lastName"], query: `*${escapeQueryText(text)}*` } });
  }
  if (positions.length) must.push(positions.length === 1
    ? { match: { position: positions[0] } }
    : { terms: { position: positions } });
  if (options.auctionable !== false) must.push({ match: { auctionable: true } });
  const minOvr = boundedRating(options.minOvr, "minOvr");
  const maxOvr = boundedRating(options.maxOvr, "maxOvr");
  if (minOvr !== undefined || maxOvr !== undefined) {
    must.push({ range: { rating: { gte: minOvr ?? 0, lte: maxOvr ?? 999 } } });
  }
  if (options.maxPrice !== undefined) {
    const maxPrice = Number(options.maxPrice);
    if (!Number.isFinite(maxPrice) || maxPrice <= 0) throw new Error("maxPrice debe ser un número positivo de monedas.");
    must.push({ range: { [`priceData.${rank}.basePrice`]: { gte: 1, lte: maxPrice } } });
  }
  const sortField = options.sort === "price" ? `priceData.${rank}.basePrice`
    : options.sort === "added" ? "added" : "rating";
  const payload = {
    query: { bool: { must, should: [], must_not: [] } },
    sort: [{ [sortField]: { order: options.sort === "price" ? "asc" : "desc" } }, { assetId: { order: "desc" } }],
    _source: [], from: 0, size: limit
  };
  if (options.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(String(options.cursor), "base64url").toString("utf8"));
      if (!Array.isArray(cursor) || cursor.length !== 2) throw new Error();
      payload.search_after = cursor;
      delete payload.from;
    } catch {
      throw new Error("cursor de búsqueda inválido.");
    }
  }
  const response = await fetchImpl(`${SEARCH_ENDPOINT}${encodeQuery(payload)}`, {
    headers: { accept: "application/json", "user-agent": "FuguRenderzModel/1.0" }
  });
  if (!response.ok) throw new Error(`RenderZ search respondió ${response.status}.`);
  const encoded = await response.json();
  const result = (typeof encoded === "string" ? decodeResponse(encoded) : encoded) || { players: [], pagination: null };
  const isFullPage = (result.players || []).length === limit;
  return {
    source: "RenderZ current Elasticsearch search", queriedAt: new Date().toISOString(),
    filters: { text: options.text || null, positions, auctionable: options.auctionable !== false, maxPrice: options.maxPrice ?? null, rank, sort: options.sort || "rating" },
    pagination: result.pagination || null,
    nextCursor: isFullPage && Array.isArray(result.pagination) ? Buffer.from(JSON.stringify(result.pagination)).toString("base64url") : null,
    players: (result.players || []).map(player => ({
      renderzId: String(player.assetId), name: player.cardName, rating: Number(player.rating), position: player.position,
      auctionable: Boolean(player.auctionable), price: Number(player.priceData?.[rank]?.basePrice || 0) || null,
      added: player.added || null, program: player.source || null, variant: cardVariant(player),
      image: player.images?.playerCardImage || null,
      playStyles: player.playStyles || []
    }))
  };
}
