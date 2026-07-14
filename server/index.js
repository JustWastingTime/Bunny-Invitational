import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOverlayTeams } from "./team-resolver.js";
import {
  buildDashboardState,
  setActiveMatch,
  recordPlacement,
  clearPlacement,
  ensureStandingsForMatch,
} from "./tournament.js";
import {
  listTeams,
  getTeam,
  createTeam,
  saveTeam,
  deleteTeam,
  emptyTeam,
  STYLES as TEAM_STYLES,
  CATEGORIES as TEAM_CATEGORIES,
} from "./team-editor.js";
import { listCharacterCatalog } from "./sprite-resolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3456;
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
    return { visible: true, sceneTransition: false };
  }
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    return {
      visible: data.visible !== false,
      sceneTransition: data.sceneTransition === true,
    };
  } catch {
    return { visible: true, sceneTransition: false };
  }
}

function writeOverlayState(patch) {
  const fullPath = path.join(ROOT, OVERLAY_STATE_REL);
  const next = { ...readOverlayState(), ...patch };
  fs.writeFileSync(
    fullPath,
    JSON.stringify(
      {
        visible: next.visible !== false,
        sceneTransition: next.sceneTransition === true,
      },
      null,
      2
    ) + "\n"
  );
}

function buildOverlayPayload() {
  const config = readJson("data/config.json");
  const courses = readJson("data/courses.json");
  const match = readJson(`data/matches/${config.activeMatch}.json`);
  const category = match.activeCategory;
  const overlayState = readOverlayState();

  return {
    visible: overlayState.visible,
    sceneTransition: overlayState.sceneTransition,
    matchId: match.id,
    day: match.day,
    matchNumber: match.matchNumber,
    round: match.round,
    category,
    track: courses.categories[category],
    conditions: courses.conditions,
    teams: resolveOverlayTeams(ROOT, match, category),
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/dashboard") {
    try {
      const overlayState = readOverlayState();
      sendJson(res, 200, buildDashboardState(ROOT, {
        overlayVisible: overlayState.visible,
        sceneTransition: overlayState.sceneTransition,
      }));
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/dashboard/active-match" && req.method === "POST") {
    try {
      const matchId = String(url.searchParams.get("value") ?? "");
      sendJson(res, 200, setActiveMatch(ROOT, matchId));
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/dashboard/placement" && req.method === "POST") {
    try {
      const body = await readRequestBody(req);
      const standings = recordPlacement(
        ROOT,
        body.matchId,
        body.category,
        body.place,
        body.teamId,
        body.slot
      );
      sendJson(res, 200, { ok: true, updatedAt: standings.updatedAt });
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/dashboard/placement/clear" && req.method === "POST") {
    try {
      const body = await readRequestBody(req);
      const standings = clearPlacement(ROOT, body.matchId, body.category, body.place ?? null);
      sendJson(res, 200, { ok: true, updatedAt: standings.updatedAt });
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/standings") {
    try {
      ensureStandingsForMatch(ROOT, readJson("data/config.json").activeMatch);
      sendJson(res, 200, readJson("data/standings.json"));
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/characters") {
    try {
      sendJson(res, 200, { characters: listCharacterCatalog(ROOT) });
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/teams") {
    try {
      if (req.method === "GET") {
        sendJson(res, 200, { teams: listTeams(ROOT), styles: TEAM_STYLES, categories: TEAM_CATEGORIES });
        return;
      }
      if (req.method === "POST") {
        const body = await readRequestBody(req);
        const team = createTeam(ROOT, body);
        sendJson(res, 201, { ok: true, team });
        return;
      }
      sendJson(res, 405, { error: "Method not allowed" });
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/teams/new" && req.method === "GET") {
    sendJson(res, 200, { team: emptyTeam("new-team", "New Team"), styles: TEAM_STYLES, categories: TEAM_CATEGORIES });
    return;
  }

  if (url.pathname.startsWith("/api/teams/")) {
    const teamId = decodeURIComponent(url.pathname.slice("/api/teams/".length));
    if (!teamId || teamId.includes("/") || teamId.includes("..")) {
      sendJson(res, 400, { error: "Invalid team id" });
      return;
    }
    try {
      if (req.method === "GET") {
        sendJson(res, 200, { team: getTeam(ROOT, teamId), styles: TEAM_STYLES, categories: TEAM_CATEGORIES });
        return;
      }
      if (req.method === "PUT") {
        const body = await readRequestBody(req);
        const team = saveTeam(ROOT, teamId, body);
        sendJson(res, 200, { ok: true, team });
        return;
      }
      if (req.method === "DELETE") {
        sendJson(res, 200, deleteTeam(ROOT, teamId));
        return;
      }
      sendJson(res, 405, { error: "Method not allowed" });
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

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
        writeOverlayState({ visible: nextVisible });
        sendJson(res, 200, { visible: nextVisible });
        return;
      }
      sendJson(res, 200, state);
    } catch (err) {
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }

  if (url.pathname === "/api/overlay/scene-transition") {
    try {
      const state = readOverlayState();
      if (req.method === "POST") {
        const action = String(url.searchParams.get("action") ?? "").toLowerCase();
        let nextActive = state.sceneTransition;
        if (action === "on") nextActive = true;
        else if (action === "off") nextActive = false;
        else if (action === "toggle") nextActive = !state.sceneTransition;
        writeOverlayState({ sceneTransition: nextActive });
        sendJson(res, 200, { sceneTransition: nextActive });
        return;
      }
      sendJson(res, 200, { sceneTransition: state.sceneTransition });
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

  if (url.pathname === "/website") {
    res.writeHead(302, { Location: "/website/index.html" });
    res.end();
    return;
  }

  // Route mapping
  let filePath;
  if (url.pathname === "/" || url.pathname === "/overlay") {
    filePath = path.join(ROOT, "overlay", "index.html");
  } else if (url.pathname === "/dashboard" || url.pathname === "/dashboard/") {
    filePath = path.join(ROOT, "dashboard", "index.html");
  } else if (url.pathname === "/dashboard/teams") {
    filePath = path.join(ROOT, "dashboard", "teams.html");
  } else if (url.pathname.startsWith("/dashboard/")) {
    filePath = path.join(ROOT, url.pathname);
  } else if (url.pathname.startsWith("/overlay/")) {
    filePath = path.join(ROOT, url.pathname);
  } else if (url.pathname.startsWith("/website/")) {
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
  console.log(`  Overlay:    http://localhost:${PORT}/overlay`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard`);
  console.log(`  Teams:      http://localhost:${PORT}/dashboard/teams`);
  console.log(`  API:        http://localhost:${PORT}/api/overlay`);
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
