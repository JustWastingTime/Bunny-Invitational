import fs from "node:fs";
import path from "node:path";
import {
  CATEGORIES,
  entryKey,
  loadTeam,
  loadMatch,
  resolveMatchRacers,
  resolveMatchTeams,
} from "./team-resolver.js";
const STANDINGS_REL = "data/standings.json";
const WEBSITE_STANDINGS_REL = "website/data/standings.json";
const WEBSITE_PUBLIC_REL = "website/data/public.json";

export function listMatchFiles(matchesDir) {
  if (!fs.existsSync(matchesDir)) return [];
  return fs
    .readdirSync(matchesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}


function readStandings(root) {
  const full = path.join(root, STANDINGS_REL);
  if (!fs.existsSync(full)) {
    return defaultStandings();
  }
  const data = JSON.parse(fs.readFileSync(full, "utf8"));
  return migrateStandings(data);
}

function defaultStandings() {
  return {
    tournament: "Bunny Invitational",
    updatedAt: null,
    scoring: { place: { "1": 5, "2": 3, "3": 1 } },
    teams: {},
    matches: {},
  };
}

function emptyPlacements() {
  return { "1": null, "2": null, "3": null };
}

function emptyRaceResults() {
  return Object.fromEntries(CATEGORIES.map((cat) => [cat, { placements: emptyPlacements() }]));
}

function migrateRaceResult(raceResult) {
  if (!raceResult) return { placements: emptyPlacements() };
  if (raceResult.placements) {
    return {
      placements: {
        "1": raceResult.placements["1"] ?? null,
        "2": raceResult.placements["2"] ?? null,
        "3": raceResult.placements["3"] ?? null,
      },
    };
  }
  if (raceResult.winner) {
    return { placements: { "1": { teamId: raceResult.winner, slot: 0 }, "2": null, "3": null } };
  }
  return { placements: emptyPlacements() };
}

function migrateStandings(standings) {
  if (!standings.scoring?.place) {
    standings.scoring = { place: { "1": 5, "2": 3, "3": 1 } };
  }
  for (const match of Object.values(standings.matches ?? {})) {
    for (const cat of CATEGORIES) {
      if (match.raceResults?.[cat]) {
        match.raceResults[cat] = migrateRaceResult(match.raceResults[cat]);
      }
    }
    delete match.matchWinner;
  }
  for (const team of Object.values(standings.teams ?? {})) {
    team.firsts = team.firsts ?? 0;
    team.seconds = team.seconds ?? 0;
    team.thirds = team.thirds ?? 0;
    delete team.raceWins;
    delete team.matchWins;
  }
  return standings;
}

function writeStandings(root, standings) {
  standings.updatedAt = new Date().toISOString();
  const full = path.join(root, STANDINGS_REL);
  fs.writeFileSync(full, JSON.stringify(standings, null, 2) + "\n");

  const websitePath = path.join(root, WEBSITE_STANDINGS_REL);
  fs.mkdirSync(path.dirname(websitePath), { recursive: true });
  fs.writeFileSync(websitePath, JSON.stringify(standings, null, 2) + "\n");

  writeWebsitePublic(root, standings);
}

function writeWebsitePublic(root, standings) {
  const publicPath = path.join(root, WEBSITE_PUBLIC_REL);
  fs.mkdirSync(path.dirname(publicPath), { recursive: true });
  fs.writeFileSync(publicPath, JSON.stringify(buildWebsiteData(root, standings), null, 2) + "\n");
}

function buildWebsiteData(root, standings) {
  const teams = Object.keys(standings.teams ?? {}).map((teamId) => {
    const team = loadTeam(root, teamId);
    const categories = Object.fromEntries(
      CATEGORIES.map((category) => [
        category,
        (team.categories?.[category] ?? []).map((member, slot) => ({
          slot,
          trainer: member.trainer,
          uma: member.uma,
        })),
      ])
    );
    return {
      id: team.id,
      name: team.name,
      shortName: team.shortName ?? team.name,
      color: team.color,
      categories,
    };
  });

  const matches = listMatchFiles(path.join(root, "data", "matches")).map((matchId) => {
    const match = loadMatch(root, matchId);
    const raceResults = standings.matches?.[matchId]?.raceResults ?? {};

    const categories = Object.fromEntries(
      CATEGORIES.map((category) => {
        const racers = resolveMatchRacers(root, matchId, category).map((racer) => ({
          teamId: racer.teamId,
          teamName: racer.teamName,
          teamColor: racer.teamColor,
          slot: racer.slot,
          gate: racer.gate,
          trainer: racer.trainer,
          umaName: racer.umaName,
          spritePath: racer.uma.spritePath,
          style: racer.uma.style ?? null,
          key: racer.key,
        }));
        const racerByKey = Object.fromEntries(racers.map((racer) => [racer.key, racer]));
        const placements = raceResults?.[category]?.placements ?? emptyPlacements();
        const enrichedPlacements = Object.fromEntries(
          ["1", "2", "3"].map((place) => {
            const pick = placements?.[place];
            if (!pick) return [place, null];
            return [place, racerByKey[entryKey(pick.teamId, pick.slot)] ?? null];
          })
        );

        return [category, { racers, placements: enrichedPlacements }];
      })
    );

    return {
      id: match.id,
      day: match.day,
      matchNumber: match.matchNumber,
      round: match.round,
      teams: match.teams,
      categories,
    };
  });

  const startsByUma = new Map();
  const winsByUma = new Map();
  const uniqueUmas = new Set();

  for (const match of matches) {
    for (const category of CATEGORIES) {
      const race = match.categories[category];
      for (const racer of race.racers) {
        const name = racer.umaName;
        uniqueUmas.add(name);
        startsByUma.set(name, (startsByUma.get(name) ?? 0) + 1);
      }
      const winner = race.placements["1"];
      if (winner?.umaName) {
        winsByUma.set(winner.umaName, (winsByUma.get(winner.umaName) ?? 0) + 1);
      }
    }
  }

  const popularity = [...startsByUma.entries()]
    .map(([umaName, starts]) => ({
      umaName,
      starts,
      wins: winsByUma.get(umaName) ?? 0,
      winRate: starts > 0 ? (winsByUma.get(umaName) ?? 0) / starts : 0,
    }))
    .sort((a, b) => b.starts - a.starts || b.wins - a.wins || a.umaName.localeCompare(b.umaName));

  const mostCommonUma = popularity[0] ?? null;
  const bestWinRateUma =
    [...popularity]
      .filter((row) => row.starts > 0)
      .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || a.umaName.localeCompare(b.umaName))[0] ??
    null;

  return {
    tournament: standings.tournament ?? "Bunny Invitational",
    updatedAt: standings.updatedAt,
    scoring: standings.scoring,
    standings: Object.entries(standings.teams ?? {})
      .map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => b.points - a.points || b.firsts - a.firsts),
    teams,
    matches,
    stats: {
      totalMatches: matches.length,
      uniqueUmaCount: uniqueUmas.size,
      mostCommonUma,
      bestWinRateUma,
      uniqueUmas: popularity.filter((row) => row.starts === 1).map((row) => row.umaName),
      popularity,
    },
  };
}


function loadMatchRacers(root, matchId, category) {
  return resolveMatchRacers(root, matchId, category).map((racer) => ({
    teamId: racer.teamId,
    slot: racer.slot,
    teamName: racer.teamName,
    teamColor: racer.teamColor,
    trainer: racer.trainer,
    umaName: racer.umaName,
    spritePath: racer.uma.spritePath,
    key: racer.key,
  }));
}

function loadMatchTeams(root, matchId, category) {
  return resolveMatchTeams(root, matchId, category).map((team) => ({
    ...team,
    racers: team.racers.map((racer) => ({
      teamId: racer.teamId,
      slot: racer.slot,
      teamName: racer.teamName,
      teamColor: racer.teamColor,
      trainer: racer.trainer,
      umaName: racer.umaName,
      spritePath: racer.uma.spritePath,
      key: racer.key,
    })),
  }));
}

function validateRacer(root, matchId, category, teamId, slot) {
  const racers = loadMatchRacers(root, matchId, category);
  const found = racers.find((r) => r.teamId === teamId && r.slot === slot);
  if (!found) throw new Error(`Invalid racer: ${teamId} slot ${slot} in ${category}`);
  return found;
}

export function ensureStandingsForMatch(root, matchId) {
  const standings = readStandings(root);
  if (standings.matches[matchId]) return standings;

  const matchPath = path.join(root, "data", "matches", `${matchId}.json`);
  if (!fs.existsSync(matchPath)) throw new Error(`Match not found: ${matchId}`);

  const match = JSON.parse(fs.readFileSync(matchPath, "utf8"));
  standings.matches[matchId] = {
    day: match.day,
    matchNumber: match.matchNumber,
    round: match.round,
    teams: match.teams,
    raceResults: emptyRaceResults(),
  };

  for (const teamId of match.teams) {
    if (!standings.teams[teamId]) {
      const team = loadTeam(root, teamId);
      standings.teams[teamId] = {
        name: team.name,
        color: team.color,
        firsts: 0,
        seconds: 0,
        thirds: 0,
        points: 0,
      };
    }
  }

  writeStandings(root, standings);
  return standings;
}

function recalculateStandings(standings) {
  for (const teamId of Object.keys(standings.teams)) {
    standings.teams[teamId].firsts = 0;
    standings.teams[teamId].seconds = 0;
    standings.teams[teamId].thirds = 0;
    standings.teams[teamId].points = 0;
  }

  const placePoints = standings.scoring.place;

  for (const match of Object.values(standings.matches)) {
    for (const category of CATEGORIES) {
      const placements = match.raceResults?.[category]?.placements ?? emptyPlacements();
      for (const place of ["1", "2", "3"]) {
        const pick = placements[place];
        if (!pick?.teamId || !standings.teams[pick.teamId]) continue;

        const pts = placePoints[place] ?? 0;
        standings.teams[pick.teamId].points += pts;
        if (place === "1") standings.teams[pick.teamId].firsts += 1;
        if (place === "2") standings.teams[pick.teamId].seconds += 1;
        if (place === "3") standings.teams[pick.teamId].thirds += 1;
      }
    }
  }

  return standings;
}

export function recordPlacement(root, matchId, category, place, teamId, slot) {
  if (!CATEGORIES.includes(category)) throw new Error(`Invalid category: ${category}`);
  if (!["1", "2", "3"].includes(String(place))) throw new Error(`Place must be 1, 2, or 3`);

  validateRacer(root, matchId, category, teamId, slot);

  const standings = ensureStandingsForMatch(root, matchId);
  const race = standings.matches[matchId].raceResults[category];
  const pick = { teamId, slot: Number(slot) };
  const pickKey = entryKey(teamId, pick.slot);

  for (const p of ["1", "2", "3"]) {
    const current = race.placements[p];
    if (current && entryKey(current.teamId, current.slot) === pickKey) {
      race.placements[p] = null;
    }
  }

  race.placements[String(place)] = pick;
  recalculateStandings(standings);
  writeStandings(root, standings);
  return standings;
}

export function clearPlacement(root, matchId, category, place) {
  const standings = ensureStandingsForMatch(root, matchId);
  if (place) {
    standings.matches[matchId].raceResults[category].placements[String(place)] = null;
  } else {
    standings.matches[matchId].raceResults[category].placements = emptyPlacements();
  }
  recalculateStandings(standings);
  writeStandings(root, standings);
  return standings;
}

export function setActiveMatch(root, matchId) {
  const matchPath = path.join(root, "data", "matches", `${matchId}.json`);
  if (!fs.existsSync(matchPath)) throw new Error(`Match not found: ${matchId}`);

  ensureStandingsForMatch(root, matchId);
  const configPath = path.join(root, "data", "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ activeMatch: matchId }, null, 2) + "\n");
  return { activeMatch: matchId };
}

function enrichPlacements(root, matchId, category, placements) {
  const racers = loadMatchRacers(root, matchId, category);
  const byKey = Object.fromEntries(racers.map((r) => [r.key, r]));

  const enriched = {};
  for (const place of ["1", "2", "3"]) {
    const pick = placements?.[place];
    if (!pick) {
      enriched[place] = null;
      continue;
    }
    const racer = byKey[entryKey(pick.teamId, pick.slot)];
    enriched[place] = racer
      ? {
          place: Number(place),
          teamId: pick.teamId,
          slot: pick.slot,
          trainer: racer.trainer,
          umaName: racer.umaName,
          teamName: racer.teamName,
          teamColor: racer.teamColor,
          spritePath: racer.spritePath,
        }
      : pick;
  }
  return enriched;
}

export function buildDashboardState(root, extras = {}) {
  const configPath = path.join(root, "data/config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const matchIds = listMatchFiles(path.join(root, "data", "matches"));

  for (const id of matchIds) ensureStandingsForMatch(root, id);
  const standings = readStandings(root);
  writeWebsitePublic(root, standings);

  const activeMatch = JSON.parse(
    fs.readFileSync(path.join(root, "data", "matches", `${config.activeMatch}.json`), "utf8")
  );

  const category = activeMatch.activeCategory;
  const teams = loadMatchTeams(root, config.activeMatch, category);
  const matchResult = standings.matches[config.activeMatch] ?? null;
  const placements = matchResult?.raceResults?.[category]?.placements ?? emptyPlacements();

  return {
    activeMatch: config.activeMatch,
    activeCategory: category,
    overlayVisible: extras.overlayVisible ?? true,
    scoring: standings.scoring,
    matches: matchIds.map((id) => {
      const m = JSON.parse(fs.readFileSync(path.join(root, "data", "matches", `${id}.json`), "utf8"));
      return { id, day: m.day, matchNumber: m.matchNumber, round: m.round, teams: m.teams };
    }),
    currentRace: {
      matchId: activeMatch.id,
      category,
      teams,
      placements: enrichPlacements(root, config.activeMatch, category, placements),
    },
    standings: {
      tournament: standings.tournament,
      updatedAt: standings.updatedAt,
      teams: Object.entries(standings.teams)
        .map(([id, row]) => ({ id, ...row }))
        .sort((a, b) => b.points - a.points || b.firsts - a.firsts),
    },
  };
}
