import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TEAM_DIR = path.join(ROOT, "data", "teams");
const CHAR_DIR = path.join(ROOT, "assets", "characters");
const CATEGORIES = ["sprint", "mile", "medium", "long", "dirt"];
const IMAGE_EXTS = ["png", "webp", "jpg", "jpeg"];

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

function teamFileCandidates(teamId) {
  return [
    path.join(TEAM_DIR, `${teamId}.json`),
    path.join(TEAM_DIR, `${teamId.replace("alliance", "aliance")}.json`),
    path.join(TEAM_DIR, `${teamId.replace("aliance", "alliance")}.json`),
  ];
}

function findTeamFile(teamId) {
  return teamFileCandidates(teamId).find((p) => fs.existsSync(p));
}

function hasSpriteFile(spriteId) {
  if (spriteId == null || spriteId === "") return false;
  const id = String(spriteId);
  if (!fs.existsSync(CHAR_DIR)) return false;

  const files = fs.readdirSync(CHAR_DIR);
  return files.some((name) => {
    const ext = path.extname(name).toLowerCase().replace(".", "");
    if (!IMAGE_EXTS.includes(ext)) return false;
    const base = path.basename(name, path.extname(name));
    if (base === id) return true;
    const parts = base.match(/\d+/g) ?? [];
    return parts.includes(id);
  });
}

function run() {
  const issues = [];
  const warnings = [];
  const config = readJson("data/config.json");
  const matchPath = path.join(ROOT, "data", "matches", `${config.activeMatch}.json`);
  if (!fs.existsSync(matchPath)) {
    throw new Error(`Active match not found: ${matchPath}`);
  }

  const match = JSON.parse(fs.readFileSync(matchPath, "utf8"));
  const teams = new Map();

  for (const teamId of match.teams) {
    const teamFile = findTeamFile(teamId);
    if (!teamFile) {
      issues.push(`Missing team file for "${teamId}" in data/teams`);
      continue;
    }

    const team = JSON.parse(fs.readFileSync(teamFile, "utf8"));
    teams.set(teamId, team);

    for (const category of CATEGORIES) {
      const roster = team.categories?.[category];
      if (!Array.isArray(roster) || roster.length !== 3) {
        issues.push(`Team "${teamId}" category "${category}" must have exactly 3 members`);
        continue;
      }

      for (const member of roster) {
        const explicitSpriteId = member?.uma?.spriteId ?? null;
        const fallbackId = member?.uma?.characterId ?? member?.uma?.id ?? null;
        const spriteId = explicitSpriteId ?? fallbackId;
        const hasSprite = hasSpriteFile(spriteId);

        if (explicitSpriteId != null && !hasSprite) {
          issues.push(
            `Missing sprite for "${teamId}" ${category}: ${member?.uma?.name ?? "Unknown"} (spriteId=${String(spriteId)}). Add numeric spriteId matching filename digits.`
          );
        } else if (explicitSpriteId == null) {
          warnings.push(
            `No numeric spriteId for "${teamId}" ${category}: ${member?.uma?.name ?? "Unknown"} (current=${String(fallbackId)}).`
          );
        }
      }
    }
  }

  for (const category of CATEGORIES) {
    const entries = match.races?.[category];
    if (!Array.isArray(entries) || entries.length !== 9) {
      issues.push(`Match "${match.id}" category "${category}" must have exactly 9 entries`);
      continue;
    }

    for (const [idx, entry] of entries.entries()) {
      if (!teams.has(entry.teamId)) {
        issues.push(`Unknown teamId in match: ${entry.teamId} (${category} #${idx + 1})`);
      }
      if (!Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot > 2) {
        issues.push(`Invalid slot in ${category} #${idx + 1}: ${entry.slot} (must be 0, 1, or 2)`);
      }
      if (entry.gate != null && (!Number.isInteger(entry.gate) || entry.gate < 1 || entry.gate > 9)) {
        issues.push(`Invalid gate in ${category} #${idx + 1}: ${entry.gate} (must be 1..9 or null)`);
      }
    }
  }

  if (issues.length) {
    console.error("Data check failed:\n");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  if (warnings.length) {
    console.log("Data check warnings (non-blocking):\n");
    for (const warning of warnings) console.log(`- ${warning}`);
    console.log("");
  }

  console.log("Data check passed.");
  console.log(`Active match: ${match.id}`);
  console.log(`Teams: ${match.teams.join(", ")}`);
}

try {
  run();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
