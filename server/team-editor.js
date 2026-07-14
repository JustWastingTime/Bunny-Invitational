import fs from "node:fs";
import path from "node:path";
import { loadMatch } from "./team-resolver.js";

export const CATEGORIES = ["sprint", "mile", "medium", "long", "dirt"];
export const STYLES = ["runaway", "front", "pace", "late", "end"];
export const APTITUDE_GRADES = ["S", "A", "B", "C", "D", "E", "F", "G"];
export const APTITUDE_KEYS = ["terrain", "distance", "style"];

const RESERVED_FILES = new Set(["_template.json"]);

function listMatchIds(root) {
  const matchesDir = path.join(root, "data", "matches");
  if (!fs.existsSync(matchesDir)) return [];
  return fs
    .readdirSync(matchesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.basename(name, ".json"));
}

function teamsDir(root) {
  return path.join(root, "data", "teams");
}

function teamPath(root, teamId) {
  return path.join(teamsDir(root), `${teamId}.json`);
}

export function slugifyTeamId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeAptitudeGrade(value, fallback = "A") {
  const grade = String(value ?? "").trim().toUpperCase();
  return APTITUDE_GRADES.includes(grade) ? grade : fallback;
}

function normalizeAptitudes(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    terrain: normalizeAptitudeGrade(src.terrain ?? src.turf),
    distance: normalizeAptitudeGrade(src.distance),
    style: normalizeAptitudeGrade(src.style),
  };
}

function emptyMember(label = "Trainer") {
  return {
    trainer: label,
    locked: false,
    uma: {
      name: "Uma Name",
      characterId: "",
      rating: "S",
      style: "front",
      aptitudes: normalizeAptitudes(),
      stats: { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 },
      skills: [],
    },
  };
}

export function emptyTeam(id = "new-team", name = "New Team") {
  const categories = {};
  for (const category of CATEGORIES) {
    categories[category] = [
      emptyMember(`${name} ${category} 1`),
      emptyMember(`${name} ${category} 2`),
      emptyMember(`${name} ${category} 3`),
    ];
  }
  return {
    id,
    name,
    shortName: name.slice(0, 8).toUpperCase(),
    tagline: "",
    color: "#e91e8c",
    categories,
  };
}

function normalizeMember(member, fallbackTrainer) {
  const src = member && typeof member === "object" ? member : {};
  const uma = src.uma && typeof src.uma === "object" ? src.uma : {};
  const stats = uma.stats && typeof uma.stats === "object" ? uma.stats : {};
  const style = STYLES.includes(String(uma.style ?? "").toLowerCase())
    ? String(uma.style).toLowerCase()
    : "front";

  const out = {
    trainer: String(src.trainer ?? fallbackTrainer).trim() || fallbackTrainer,
    locked: Boolean(src.locked),
    uma: {
      name: String(uma.name ?? "Uma Name").trim() || "Uma Name",
      rating: String(uma.rating ?? "S").trim() || "S",
      style,
      aptitudes: normalizeAptitudes(uma.aptitudes),
      stats: {
        speed: Number(stats.speed) || 0,
        stamina: Number(stats.stamina) || 0,
        power: Number(stats.power) || 0,
        guts: Number(stats.guts) || 0,
        wisdom: Number(stats.wisdom) || 0,
      },
      skills: Array.isArray(uma.skills)
        ? uma.skills.map((skill) => String(skill).trim()).filter(Boolean)
        : String(uma.skills ?? "")
            .split(",")
            .map((skill) => skill.trim())
            .filter(Boolean),
    },
  };

  const characterId = String(uma.characterId ?? "").trim();
  const spriteId = uma.spriteId;
  if (characterId) out.uma.characterId = characterId;
  if (spriteId !== undefined && spriteId !== null && String(spriteId).trim() !== "") {
    out.uma.spriteId = Number.isFinite(Number(spriteId)) && String(spriteId).trim() !== ""
      ? Number(spriteId)
      : String(spriteId).trim();
  }
  if (!out.uma.characterId && (out.uma.spriteId === undefined || out.uma.spriteId === "")) {
    out.uma.characterId = "";
  }

  return out;
}

export function normalizeTeam(raw, { requireId = true } = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const id = slugifyTeamId(src.id ?? src.name);
  if (requireId && !id) throw new Error("Team id is required");

  const name = String(src.name ?? id).trim() || id;
  const categories = {};
  for (const category of CATEGORIES) {
    const roster = Array.isArray(src.categories?.[category]) ? src.categories[category] : [];
    categories[category] = [0, 1, 2].map((slot) =>
      normalizeMember(roster[slot], `${name} ${category} ${slot + 1}`)
    );
  }

  return {
    id,
    name,
    shortName: String(src.shortName ?? name).trim() || name,
    tagline: String(src.tagline ?? "").trim(),
    color: String(src.color ?? "#e91e8c").trim() || "#e91e8c",
    categories,
  };
}

/** Compact formatter so IDE folding keeps trainer/uma subject on the first line. */
export function serializeTeam(team) {
  const lines = [];
  lines.push(`{ "id": ${JSON.stringify(team.id)},`);
  lines.push(`  "name": ${JSON.stringify(team.name)},`);
  lines.push(`  "shortName": ${JSON.stringify(team.shortName)},`);
  if (team.tagline) lines.push(`  "tagline": ${JSON.stringify(team.tagline)},`);
  lines.push(`  "color": ${JSON.stringify(team.color)},`);
  lines.push(`  "categories": {`);

  CATEGORIES.forEach((category, catIdx) => {
    const roster = team.categories[category];
    lines.push(`    ${JSON.stringify(category)}: [`);
    roster.forEach((member, slot) => {
      const uma = member.uma;
      const umaInner = [
        `"name": ${JSON.stringify(uma.name)}`,
        uma.characterId !== undefined ? `"characterId": ${JSON.stringify(uma.characterId)}` : null,
        uma.spriteId !== undefined && uma.spriteId !== ""
          ? `"spriteId": ${JSON.stringify(uma.spriteId)}`
          : null,
        `"rating": ${JSON.stringify(uma.rating)}`,
        `"style": ${JSON.stringify(uma.style)}`,
        `"aptitudes": { "terrain": ${JSON.stringify(uma.aptitudes.terrain)}, "distance": ${JSON.stringify(uma.aptitudes.distance)}, "style": ${JSON.stringify(uma.aptitudes.style)} }`,
        `"stats": { "speed": ${uma.stats.speed}, "stamina": ${uma.stats.stamina}, "power": ${uma.stats.power}, "guts": ${uma.stats.guts}, "wisdom": ${uma.stats.wisdom} }`,
        `"skills": ${JSON.stringify(uma.skills)}`,
      ].filter(Boolean);

      lines.push(`      { "trainer": ${JSON.stringify(member.trainer)},`);
      if (member.locked) lines.push(`        "locked": true,`);
      lines.push(`        "uma": { ${umaInner[0]},`);
      for (let i = 1; i < umaInner.length; i += 1) {
        const comma = i < umaInner.length - 1 ? "," : " }";
        lines.push(`          ${umaInner[i]}${comma}`);
      }
      lines.push(`      }${slot < roster.length - 1 ? "," : ""}`);
    });
    lines.push(`    ]${catIdx < CATEGORIES.length - 1 ? "," : ""}`);
  });

  lines.push(`  }`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}

export function listTeams(root) {
  const dir = teamsDir(root);
  if (!fs.existsSync(dir)) return [];

  const byId = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || RESERVED_FILES.has(name)) continue;
    try {
      const team = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      const id = team.id ?? path.basename(name, ".json");
      const entry = {
        id,
        name: team.name ?? path.basename(name, ".json"),
        shortName: team.shortName ?? "",
        color: team.color ?? "#999",
        file: name,
      };
      const existing = byId.get(id);
      // Prefer canonical filename matching id
      if (!existing || name === `${id}.json`) byId.set(id, entry);
    } catch {
      // skip invalid files
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getTeam(root, teamId) {
  const filePath = teamPath(root, teamId);
  if (!fs.existsSync(filePath)) {
    // legacy typo fallback
    const alt = teamPath(root, teamId.replace("alliance", "aliance"));
    if (fs.existsSync(alt)) {
      return normalizeTeam(JSON.parse(fs.readFileSync(alt, "utf8")));
    }
    throw new Error(`Team not found: ${teamId}`);
  }
  return normalizeTeam(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function createTeam(root, payload) {
  const team = normalizeTeam({
    ...emptyTeam(),
    ...payload,
    id: payload?.id || payload?.name,
  });
  const filePath = teamPath(root, team.id);
  if (fs.existsSync(filePath)) {
    throw new Error(`Team "${team.id}" already exists`);
  }
  fs.writeFileSync(filePath, serializeTeam(team));
  return team;
}

export function saveTeam(root, teamId, payload) {
  const existingPath = teamPath(root, teamId);
  const legacyPath = teamPath(root, teamId.replace("alliance", "aliance"));
  const sourcePath = fs.existsSync(existingPath)
    ? existingPath
    : fs.existsSync(legacyPath)
      ? legacyPath
      : null;
  if (!sourcePath) throw new Error(`Team not found: ${teamId}`);

  const team = normalizeTeam({ ...payload, id: teamId });
  // Always write to canonical id filename
  fs.writeFileSync(teamPath(root, team.id), serializeTeam(team));
  if (sourcePath !== teamPath(root, team.id) && fs.existsSync(sourcePath)) {
    fs.unlinkSync(sourcePath);
  }
  return team;
}

export function deleteTeam(root, teamId) {
  const usedIn = listMatchIds(root).filter((matchId) => {
    try {
      const match = loadMatch(root, matchId);
      return Array.isArray(match.teams) && match.teams.includes(teamId);
    } catch {
      return false;
    }
  });
  if (usedIn.length) {
    throw new Error(`Cannot delete "${teamId}" — used in matches: ${usedIn.join(", ")}`);
  }

  const filePath = teamPath(root, teamId);
  const legacyPath = teamPath(root, teamId.replace("alliance", "aliance"));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  else if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
  else throw new Error(`Team not found: ${teamId}`);

  return { ok: true, id: teamId };
}
