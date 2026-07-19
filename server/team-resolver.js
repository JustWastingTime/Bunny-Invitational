import fs from "node:fs";
import path from "node:path";
import { buildSpriteLookup, resolveSpritePath } from "./sprite-resolver.js";

/** Roster categories on team JSON files. */
export const CATEGORIES = ["sprint", "mile", "medium", "long", "dirt"];

/** Grand Finals extras — reuse an existing roster category. */
export const RACE_ALIASES = {
  dirt2: "dirt",
  medium2: "medium",
};

/** All race keys that can appear on a match (base + finals extras). */
export const ALL_RACE_KEYS = [...CATEGORIES, "dirt2", "medium2"];

export const RACE_LABELS = {
  sprint: "Sprint",
  mile: "Mile",
  medium: "Medium",
  long: "Long",
  dirt: "Dirt",
  dirt2: "Dirt 2",
  medium2: "Medium 2",
};

export function isValidRaceKey(raceKey) {
  return ALL_RACE_KEYS.includes(raceKey);
}

/** Map a race key to the team roster category it pulls umas from. */
export function rosterCategory(raceKey) {
  return RACE_ALIASES[raceKey] ?? raceKey;
}

export function raceLabel(raceKey) {
  return RACE_LABELS[raceKey] ?? String(raceKey ?? "");
}

/** Race list for a match — Grand Finals gets Dirt 2 + Medium 2. */
export function raceKeysForMatch(match) {
  const id = String(match?.id ?? "");
  const round = String(match?.round ?? "").trim().toLowerCase();
  if (id === "day1-match12" || round === "finals") {
    return [...ALL_RACE_KEYS];
  }
  return [...CATEGORIES];
}

function teamFileCandidates(root, teamId) {
  return [
    path.join(root, "data", "teams", `${teamId}.json`),
    path.join(root, "data", "teams", `${teamId.replace("alliance", "aliance")}.json`),
    path.join(root, "data", "teams", `${teamId.replace("aliance", "alliance")}.json`),
  ];
}

export function findTeamFile(root, teamId) {
  return teamFileCandidates(root, teamId).find((filePath) => fs.existsSync(filePath)) ?? null;
}

/** Load a club roster from data/teams/{teamId}.json (e.g. dust-bunny → dust-bunny.json). */
export function loadTeam(root, teamId) {
  const teamFile = findTeamFile(root, teamId);
  if (!teamFile) {
    throw new Error(
      `Team file not found for "${teamId}". Expected data/teams/${teamId}.json`
    );
  }
  return JSON.parse(fs.readFileSync(teamFile, "utf8"));
}

export function loadMatch(root, matchId) {
  const matchPath = path.join(root, "data", "matches", `${matchId}.json`);
  if (!fs.existsSync(matchPath)) {
    throw new Error(`Match not found: ${matchId}`);
  }
  return JSON.parse(fs.readFileSync(matchPath, "utf8"));
}

export function entryKey(teamId, slot) {
  return `${teamId}:${slot}`;
}

/** Resolve trainer + uma for one slot from the team JSON roster. */
export function getTeamMember(root, teamId, category, slot) {
  const team = loadTeam(root, teamId);
  const rosterKey = rosterCategory(category);
  const roster = team.categories?.[rosterKey];
  if (!Array.isArray(roster)) {
    throw new Error(`Team "${teamId}" has no "${rosterKey}" roster in data/teams`);
  }

  const member = roster[slot];
  if (!member) {
    throw new Error(`Team "${teamId}" ${rosterKey} slot ${slot} not found in data/teams`);
  }

  return { team, member };
}

function enrichUma(uma, spriteLookup) {
  const spriteId = uma.spriteId ?? uma.characterId ?? uma.id ?? null;
  const spritePath = resolveSpritePath(uma, spriteLookup);
  return {
    ...uma,
    spriteId: spriteId == null ? null : String(spriteId),
    spritePath,
  };
}

/** Stable identity for uniqueness: costume spriteId first, else display name (skins differ). */
export function umaIdentityKey(uma) {
  const sid = uma?.spriteId ?? uma?.characterId ?? uma?.id;
  if (sid != null && String(sid).trim() !== "") return `sprite:${String(sid).trim()}`;
  const name = String(uma?.name ?? "").trim();
  if (name) return `name:${name}`;
  return null;
}

/**
 * Match files only store teamId + slot (+ gate).
 * Trainer names, uma stats, sprites, etc. always come from data/teams/*.json.
 */
export function resolveRacer(root, matchEntry, category, spriteLookup = null) {
  const lookup = spriteLookup ?? buildSpriteLookup(root);
  const { team, member } = getTeamMember(root, matchEntry.teamId, category, matchEntry.slot);
  const uma = enrichUma(member.uma ?? {}, lookup);

  return {
    teamId: matchEntry.teamId,
    slot: matchEntry.slot,
    gate: matchEntry.gate ?? null,
    teamName: team.name,
    teamColor: team.color,
    trainer: member.trainer,
    umaName: uma.name ?? "Unknown",
    umaKey: umaIdentityKey(uma),
    uma,
    key: entryKey(matchEntry.teamId, matchEntry.slot),
  };
}

export function resolveMatchRacers(root, matchId, category) {
  const match = loadMatch(root, matchId);
  const entries = match.races?.[category] ?? [];
  const spriteLookup = buildSpriteLookup(root);
  return entries
    .filter((entry) => entry?.teamId)
    .map((entry) => resolveRacer(root, entry, category, spriteLookup));
}

export function resolveMatchTeams(root, matchId, category) {
  const match = loadMatch(root, matchId);
  const racers = resolveMatchRacers(root, matchId, category);

  return match.teams.map((teamId) => {
    if (!teamId) {
      return { id: "", name: "TBD", color: "#666666", racers: [] };
    }
    const team = loadTeam(root, teamId);
    return {
      id: team.id,
      name: team.name,
      color: team.color,
      racers: racers.filter((racer) => racer.teamId === teamId),
    };
  });
}

/** Overlay shape: teams[] with entries[] per club column. */
export function resolveOverlayTeams(root, match, category) {
  const raceEntries = match.races?.[category] ?? [];
  const spriteLookup = buildSpriteLookup(root);

  return match.teams.map((teamId) => {
    if (!teamId) {
      return { id: "", name: "TBD", color: "#666666", entries: [] };
    }
    const team = loadTeam(root, teamId);
    const entries = raceEntries
      .filter((entry) => entry.teamId === teamId)
      .map((entry) => {
        const racer = resolveRacer(root, entry, category, spriteLookup);
        return {
          teamId,
          slot: entry.slot,
          gate: entry.gate,
          trainer: racer.trainer,
          uma: racer.uma,
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
}
