import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3456;
const IMAGE_EXTS = new Set([".png", ".webp", ".jpg", ".jpeg"]);
const OVERLAY_STATE_REL = "data/overlay-state.json";
const CATEGORIES = ["sprint", "mile", "medium", "long", "dirt"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function readJson(relPath) {
  const full = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function writeJson(relPath, data) {
  const full = path.join(ROOT, relPath);
  fs.writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
}

function readOverlayState() {
  const fullPath = path.join(ROOT, OVERLAY_STATE_REL);
  if (!fs.existsSync(fullPath)) {
    return { visible: true };
  }
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    return { visible: data.visible !== false };
  } catch {
    return { visible: true };
  }
}

function writeOverlayState(visible) {
  const fullPath = path.join(ROOT, OVERLAY_STATE_REL);
  fs.writeFileSync(fullPath, JSON.stringify({ visible: Boolean(visible) }, null, 2) + "\n");
}

function loadTeam(teamId) {
  const candidates = [
    `data/teams/${teamId}.json`,
    // Temporary compatibility for "umaliance" vs "umalliance" typo variants.
    `data/teams/${teamId.replace("alliance", "aliance")}.json`,
    `data/teams/${teamId.replace("aliance", "alliance")}.json`,
  ];

  for (const relPath of candidates) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath)) return readJson(relPath);
  }

  throw new Error(
    `Team file not found for "${teamId}". Tried: ${candidates.map((p) => `"${p}"`).join(", ")}`
  );
}

function buildSpriteIndex() {
  const dir = path.join(ROOT, "assets", "characters");
  const index = new Map();
  if (!fs.existsSync(dir)) return index;

  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of files) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    const base = path.basename(entry.name, ext);
    const webPath = `/assets/characters/${entry.name}`;

    // Direct numeric filename, e.g. 100101.png
    if (/^\d+$/.test(base) && !index.has(base)) index.set(base, webPath);

    // Pattern support, e.g. chara_stand_1001_100101.png
    const numericParts = base.match(/\d+/g) ?? [];
    for (const id of numericParts) {
      if (!index.has(id)) index.set(id, webPath);
    }
  }

  return index;
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildSpriteMapLookup() {
  const lookup = {
    bySpriteIdPath: new Map(),
    byCharacterNamePath: new Map(),
    byDisplayNamePath: new Map(),
  };

  const relPath = "data/sprite-map.json";
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return lookup;

  const spriteMap = readJson(relPath);
  const rows = Object.values(spriteMap.bySpriteId ?? {});

  for (const row of rows) {
    if (!row?.spriteId || !row?.file) continue;
    const webPath = `/assets/characters/${row.file}`;
    lookup.bySpriteIdPath.set(String(row.spriteId), webPath);

    const charKey = normalizeName(row.characterName);
    const displayKey = normalizeName(row.displayName);
    const isOriginal = String(row.variant ?? "").toLowerCase() === "original";

    if (charKey) {
      if (!lookup.byCharacterNamePath.has(charKey) || isOriginal) {
        lookup.byCharacterNamePath.set(charKey, webPath);
      }
    }
    if (displayKey) lookup.byDisplayNamePath.set(displayKey, webPath);
  }

  return lookup;
}

function resolveSpritePath(uma, spriteIndex, spriteMapLookup) {
  const rawId = uma.spriteId ?? uma.characterId ?? uma.id ?? null;
  const rawIdStr = rawId == null ? "" : String(rawId).trim();

  if (rawIdStr) {
    const byPattern = spriteIndex.get(rawIdStr);
    if (byPattern) return byPattern;

    const byIdMap = spriteMapLookup.bySpriteIdPath.get(rawIdStr);
    if (byIdMap) return byIdMap;
  }

  // Support existing slug/name fields like "special-week".
  const nameKey = normalizeName(uma.name);
  const slugKey = normalizeName(String(uma.characterId ?? ""));
  const displayOriginalKey = normalizeName(`${uma.name ?? ""} (Original)`);

  return (
    spriteMapLookup.byDisplayNamePath.get(displayOriginalKey) ??
    spriteMapLookup.byCharacterNamePath.get(nameKey) ??
    spriteMapLookup.byCharacterNamePath.get(slugKey) ??
    null
  );
}

function buildOverlayPayload() {
  const config = readJson("data/config.json");
  const courses = readJson("data/courses.json");
  const match = readJson(`data/matches/${config.activeMatch}.json`);
  const category = match.activeCategory;
  const raceEntries = match.races[category];
  const spriteIndex = buildSpriteIndex();
  const spriteMapLookup = buildSpriteMapLookup();
  const overlayState = readOverlayState();

  const teams = match.teams.map((teamId) => {
    const team = loadTeam(teamId);
    const teamEntries = raceEntries.filter((e) => e.teamId === teamId);

    const entries = teamEntries.map((entry) => {
      const member = team.categories[category][entry.slot];
      const spriteId = member.uma.spriteId ?? member.uma.characterId ?? member.uma.id ?? null;
      const spritePath = resolveSpritePath(member.uma, spriteIndex, spriteMapLookup);
      return {
        teamId,
        slot: entry.slot,
        gate: entry.gate,
        trainer: member.trainer,
        uma: {
          ...member.uma,
          spriteId: spriteId == null ? null : String(spriteId),
          spritePath,
        },
        teamColor: team.color,
      };
    });

    return {
      id: team.id,
      name: team.name,
      color: team.color,
      entries,
    };
  });

  return {
    visible: overlayState.visible,
    matchId: match.id,
    day: match.day,
    matchNumber: match.matchNumber,
    round: match.round,
    category,
    track: courses.categories[category],
    conditions: courses.conditions,
    teams,
  };
}

function setActiveCategory(category) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Invalid category "${category}". Expected one of: ${CATEGORIES.join(", ")}`);
  }
  const config = readJson("data/config.json");
  const matchRel = `data/matches/${config.activeMatch}.json`;
  const match = readJson(matchRel);
  match.activeCategory = category;
  writeJson(matchRel, match);
  return { activeMatch: config.activeMatch, activeCategory: category };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store, no-cache, must-revalidate" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/overlay") {
    try {
      sendJson(res, 200, buildOverlayPayload());
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/overlay/visibility") {
    try {
      const state = readOverlayState();
      if (req.method === "POST") {
        const action = String(url.searchParams.get("action") ?? "").toLowerCase();
        let nextVisible = state.visible;
        if (action === "show") nextVisible = true;
        else if (action === "hide") nextVisible = false;
        else if (action === "toggle") nextVisible = !state.visible;
        writeOverlayState(nextVisible);
        sendJson(res, 200, { visible: nextVisible });
        return;
      }
      sendJson(res, 200, state);
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/overlay/category") {
    try {
      if (req.method === "POST") {
        const category = String(url.searchParams.get("value") ?? "").toLowerCase();
        sendJson(res, 200, setActiveCategory(category));
        return;
      }

      const config = readJson("data/config.json");
      const match = readJson(`data/matches/${config.activeMatch}.json`);
      sendJson(res, 200, { activeMatch: config.activeMatch, activeCategory: match.activeCategory });
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  // Route mapping
  let filePath;
  if (url.pathname === "/" || url.pathname === "/overlay") {
    filePath = path.join(ROOT, "overlay", "index.html");
  } else if (url.pathname.startsWith("/overlay/")) {
    filePath = path.join(ROOT, url.pathname);
  } else if (url.pathname.startsWith("/assets/")) {
    filePath = path.join(ROOT, url.pathname);
  } else if (url.pathname.startsWith("/data/")) {
    filePath = path.join(ROOT, url.pathname);
  } else {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Bunny Invitational overlay server`);
  console.log(`  Overlay:  http://localhost:${PORT}/overlay`);
  console.log(`  API:      http://localhost:${PORT}/api/overlay`);
  console.log(`\nEdit JSON in data/ — overlay auto-refreshes every second.`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — another overlay server is probably still running.`);
    console.error(`Stop it first, or run:  $env:PORT=3457; npm start`);
    process.exit(1);
  }
  throw err;
});
