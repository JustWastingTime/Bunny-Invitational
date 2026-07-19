import fs from "node:fs";
import path from "node:path";
import { loadMatch, CATEGORIES, ALL_RACE_KEYS, isValidRaceKey, raceKeysForMatch } from "./team-resolver.js";
import { listTeams } from "./team-editor.js";

export { CATEGORIES, ALL_RACE_KEYS, raceKeysForMatch } from "./team-resolver.js";

/** Bracket slots → match files (order matches website bracket). */
export const BRACKET_MATCHES = [
  { id: "day1-match01", battleId: "group-a-match-1", label: "Group A Match 1", day: 1, matchNumber: 1 },
  { id: "day1-match02", battleId: "group-a-match-2", label: "Group A Match 2", day: 1, matchNumber: 2 },
  { id: "day1-match03", battleId: "group-b-match-1", label: "Group B Match 1", day: 1, matchNumber: 3 },
  { id: "day1-match04", battleId: "group-b-match-2", label: "Group B Match 2", day: 1, matchNumber: 4 },
  { id: "day1-match05", battleId: "group-a-match-3-middle", label: "Group A Match 3 (MIDDLE)", day: 1, matchNumber: 5 },
  { id: "day1-match06", battleId: "group-b-middle-3-middle", label: "Group B Middle 3 (MIDDLE)", day: 1, matchNumber: 6 },
  { id: "day1-match07", battleId: "group-a-second-stage", label: "Group A Second Stage", day: 1, matchNumber: 7 },
  { id: "day1-match08", battleId: "group-b-second-stage", label: "Group B Second Stage", day: 1, matchNumber: 8 },
  { id: "day1-match09", battleId: "group-a-semi", label: "Group A Semi", day: 1, matchNumber: 9 },
  { id: "day1-match10", battleId: "group-b-semi", label: "Group B Semi", day: 1, matchNumber: 10 },
  { id: "day1-match11", battleId: "lower-finals", label: "Lower Finals", day: 1, matchNumber: 11 },
  { id: "day1-match12", battleId: "finals", label: "Finals", day: 1, matchNumber: 12 },
];

const META_BY_ID = Object.fromEntries(BRACKET_MATCHES.map((row) => [row.id, row]));

function matchesDir(root) {
  return path.join(root, "data", "matches");
}

function matchPath(root, matchId) {
  return path.join(matchesDir(root), `${matchId}.json`);
}

export function buildRaceEntries(teams, previousRaces = null, raceKeys = CATEGORIES) {
  const roster = [teams[0] || "", teams[1] || "", teams[2] || ""];
  const keys = raceKeys?.length ? raceKeys : CATEGORIES;
  const gateLookup = new Map();
  if (previousRaces && typeof previousRaces === "object") {
    for (const cat of Object.keys(previousRaces)) {
      for (const entry of previousRaces[cat] ?? []) {
        if (!entry?.teamId) continue;
        gateLookup.set(`${cat}:${entry.teamId}:${entry.slot}`, entry.gate ?? null);
      }
    }
  }

  return Object.fromEntries(
    keys.map((cat) => {
      const entries = [];
      for (const teamId of roster) {
        for (let slot = 0; slot < 3; slot += 1) {
          entries.push({
            teamId,
            slot,
            gate: teamId ? gateLookup.get(`${cat}:${teamId}:${slot}`) ?? null : null,
          });
        }
      }
      return [cat, entries];
    })
  );
}

/** Live-edit a post-draw gate (1–9) on a race entry. Empty clears to null. */
export function setRaceGate(root, matchId, category, teamId, slot, gate) {
  if (!isValidRaceKey(category)) throw new Error(`Invalid category: ${category}`);
  if (!teamId) throw new Error("teamId is required");

  const filePath = matchPath(root, matchId);
  if (!fs.existsSync(filePath)) throw new Error(`Match not found: ${matchId}`);

  let normalizedGate = null;
  if (gate !== null && gate !== undefined && String(gate).trim() !== "") {
    const n = Number(gate);
    if (!Number.isInteger(n) || n < 1 || n > 9) {
      throw new Error("Gate must be an integer from 1 to 9, or empty");
    }
    normalizedGate = n;
  }

  const match = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const entries = match.races?.[category];
  if (!Array.isArray(entries)) throw new Error(`No race entries for ${category}`);

  const slotNum = Number(slot);
  const entry = entries.find((row) => row.teamId === teamId && Number(row.slot) === slotNum);
  if (!entry) throw new Error(`Entry not found: ${teamId} slot ${slot}`);

  entry.gate = normalizedGate;
  fs.writeFileSync(filePath, serializeMatch(match));
  return { matchId, category, teamId, slot: slotNum, gate: normalizedGate };
}

export function emptyMatch({ id, day, matchNumber, round, teams = ["", "", ""] }) {
  const roster = [teams[0] || "", teams[1] || "", teams[2] || ""];
  const draft = {
    id,
    day: Number(day) || 1,
    matchNumber: Number(matchNumber) || 1,
    round: round || "TBD",
    teams: roster,
    activeCategory: "sprint",
  };
  return {
    ...draft,
    races: buildRaceEntries(roster, null, raceKeysForMatch(draft)),
  };
}

function serializeMatch(match) {
  return JSON.stringify(match, null, 2) + "\n";
}

function teamLabel(teams, teamId) {
  if (!teamId) return "TBD";
  const found = teams.find((t) => t.id === teamId);
  return found?.name ?? teamId;
}

export function listMatches(root) {
  const teams = listTeams(root);
  const dir = matchesDir(root);
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.basename(name, ".json"));

  const rows = files.map((id) => {
    const match = loadMatch(root, id);
    const meta = META_BY_ID[id];
    const roster = Array.isArray(match.teams) ? match.teams : ["", "", ""];
    const filled = roster.filter(Boolean).length;
    return {
      id,
      day: match.day,
      matchNumber: match.matchNumber,
      round: match.round,
      teams: roster,
      teamNames: roster.map((teamId) => teamLabel(teams, teamId)),
      filled,
      label: meta?.label ?? match.round ?? id,
      battleId: meta?.battleId ?? null,
    };
  });

  rows.sort((a, b) => {
    const aMeta = META_BY_ID[a.id];
    const bMeta = META_BY_ID[b.id];
    if (aMeta && bMeta) return aMeta.matchNumber - bMeta.matchNumber;
    if (aMeta) return -1;
    if (bMeta) return 1;
    return a.id.localeCompare(b.id);
  });

  return rows;
}

export function getMatch(root, matchId) {
  const match = loadMatch(root, matchId);
  const meta = META_BY_ID[matchId];
  return {
    ...match,
    teams: [match.teams?.[0] || "", match.teams?.[1] || "", match.teams?.[2] || ""],
    label: meta?.label ?? match.round,
    battleId: meta?.battleId ?? null,
  };
}

function normalizeTeamsPayload(rawTeams, availableIds) {
  if (!Array.isArray(rawTeams) || rawTeams.length !== 3) {
    throw new Error("Match requires exactly 3 team slots");
  }
  const teams = rawTeams.map((id) => String(id ?? "").trim());
  const filled = teams.filter(Boolean);
  if (new Set(filled).size !== filled.length) {
    throw new Error("A team cannot appear twice in the same match");
  }
  for (const id of filled) {
    if (!availableIds.has(id)) throw new Error(`Unknown team: ${id}`);
  }
  return teams;
}

export function saveMatch(root, matchId, payload) {
  const filePath = matchPath(root, matchId);
  if (!fs.existsSync(filePath)) throw new Error(`Match not found: ${matchId}`);

  const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const availableIds = new Set(listTeams(root).map((t) => t.id));
  const teams = normalizeTeamsPayload(payload?.teams ?? existing.teams, availableIds);

  const draft = {
    id: matchId,
    day: Number(payload?.day ?? existing.day) || 1,
    matchNumber: Number(payload?.matchNumber ?? existing.matchNumber) || 1,
    round: String(payload?.round ?? existing.round ?? "TBD").trim() || "TBD",
    teams,
  };
  const raceKeys = raceKeysForMatch(draft);
  const activeCategory = isValidRaceKey(payload?.activeCategory)
    ? payload.activeCategory
    : isValidRaceKey(existing.activeCategory)
      ? existing.activeCategory
      : "sprint";

  const match = {
    ...draft,
    activeCategory,
    races: buildRaceEntries(teams, existing.races, raceKeys),
  };

  fs.writeFileSync(filePath, serializeMatch(match));
  syncStandingsMatch(root, match);
  return getMatch(root, matchId);
}

function syncStandingsMatch(root, match) {
  const standingsPath = path.join(root, "data", "standings.json");
  if (!fs.existsSync(standingsPath)) return;

  const standings = JSON.parse(fs.readFileSync(standingsPath, "utf8"));
  const prev = standings.matches?.[match.id];
  if (!prev) return;

  standings.matches[match.id] = {
    ...prev,
    day: match.day,
    matchNumber: match.matchNumber,
    round: match.round,
    teams: match.teams,
  };
  standings.updatedAt = new Date().toISOString();
  fs.writeFileSync(standingsPath, JSON.stringify(standings, null, 2) + "\n");
}
