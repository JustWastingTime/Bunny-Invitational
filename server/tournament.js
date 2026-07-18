import fs from "node:fs";
import path from "node:path";
import {
  CATEGORIES,
  entryKey,
  loadTeam,
  loadMatch,
  resolveMatchRacers,
  resolveMatchTeams,
  resolveRacer,
  getTeamMember,
  umaIdentityKey,
} from "./team-resolver.js";
import { publishWebsiteSprites, publishWebsiteTeams, publishWebsiteRunstyles, publishWebsiteSkills, buildWebsiteTeams } from "./website-publish.js";
import { buildSpriteLookup, resolveSpritePath, listCharacterCatalog } from "./sprite-resolver.js";
import { listTeams } from "./team-editor.js";
import { listSkills } from "./skills.js";
const STANDINGS_REL = "data/standings.json";
const WEBSITE_STANDINGS_REL = "website/data/standings.json";
const WEBSITE_PUBLIC_REL = "website/data/public.json";

const DEFAULT_SCORING = {
  place: { "1": 5, "2": 3, "3": 1 },
  uniqueBonus: 1,
};

/** Highest → lowest uma rating for trainer leaderboard. */
const RATING_ORDER = [
  "UF",
  "UG9",
  "UG8",
  "UG7",
  "UG6",
  "UG5",
  "UG4",
  "UG3",
  "UG2",
  "UG1",
  "UG",
  "SS+",
  "SS",
  "S+",
  "S",
];
const RATING_RANK = new Map(RATING_ORDER.map((rating, index) => [rating, index]));

const STYLE_LABELS = {
  runaway: "Runaway",
  front: "Front Runner",
  pace: "Pace Chaser",
  late: "Late Surger",
  end: "End Closer",
};

/** Catalog characters that are not in the live game yet — hide from Unpicked. */
const UNPICKED_EXCLUDE_NAMES = new Set([
  "copanorickey",
  "seekingthepearl",
  "yukinobijin",
]);

function normalizeCharacterKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

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
    scoring: { ...DEFAULT_SCORING, place: { ...DEFAULT_SCORING.place } },
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
    standings.scoring = { ...DEFAULT_SCORING, place: { ...DEFAULT_SCORING.place } };
  } else if (standings.scoring.uniqueBonus == null) {
    standings.scoring.uniqueBonus = DEFAULT_SCORING.uniqueBonus;
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
    team.uniqueBonuses = team.uniqueBonuses ?? 0;
    delete team.raceWins;
    delete team.matchWins;
  }
  return standings;
}

/**
 * Unique = appears exactly once across every team's full roster (all categories).
 * Identity is costume spriteId when present, otherwise display name.
 */
export function buildRosterUniqueIndex(root) {
  const counts = new Map();
  const samples = new Map();

  for (const summary of listTeams(root)) {
    let team;
    try {
      team = loadTeam(root, summary.id);
    } catch {
      continue;
    }
    for (const roster of Object.values(team.categories ?? {})) {
      for (const member of roster ?? []) {
        const key = umaIdentityKey(member?.uma ?? {});
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (!samples.has(key)) {
          samples.set(key, {
            umaKey: key,
            umaName: member.uma?.name ?? "Unknown",
            spriteId: member.uma?.spriteId ?? member.uma?.characterId ?? null,
          });
        }
      }
    }
  }

  const uniqueKeys = new Set();
  const uniqueUmas = [];
  for (const [key, count] of counts.entries()) {
    if (count !== 1) continue;
    uniqueKeys.add(key);
    uniqueUmas.push(samples.get(key));
  }

  uniqueUmas.sort((a, b) => a.umaName.localeCompare(b.umaName));
  return { uniqueKeys, uniqueUmas, counts };
}

function isUniqueMember(root, uniqueKeys, teamId, category, slot) {
  if (!teamId) return false;
  try {
    const { member } = getTeamMember(root, teamId, category, slot);
    const key = umaIdentityKey(member?.uma ?? {});
    return Boolean(key && uniqueKeys.has(key));
  } catch {
    return false;
  }
}

function normalizeSkillKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[◎○◯★☆♪]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function isPlaceholderUma(uma) {
  const name = String(uma?.name ?? "").trim();
  if (!name || name === "Uma Name") return true;
  return false;
}

/** Strip costume parentheses so skins share one combined identity. */
function baseCharacterName(name) {
  return String(name ?? "")
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .trim();
}

function ratingRank(rating) {
  const key = String(rating ?? "").trim().toUpperCase();
  return RATING_RANK.has(key) ? RATING_RANK.get(key) : RATING_ORDER.length + 50;
}

function aptitudeIsS(aptitudes, key) {
  return String(aptitudes?.[key] ?? "").trim().toUpperCase() === "S";
}

/** Weighted stat total for team power rankings only (sheet numbers stay raw). */
function sumUmaStatsForTeamPower(uma) {
  const stats = uma?.stats ?? {};
  const aptitudes = uma?.aptitudes ?? {};
  const speedMul = aptitudeIsS(aptitudes, "distance") ? 1.1 : 1;
  const powerMul = aptitudeIsS(aptitudes, "terrain") ? 1.1 : 1;
  const witMul = aptitudeIsS(aptitudes, "style") ? 1.1 : 1;

  return (
    (Number(stats.speed) || 0) * speedMul +
    (Number(stats.stamina) || 0) +
    (Number(stats.power) || 0) * powerMul +
    (Number(stats.guts) || 0) +
    (Number(stats.wisdom) || 0) * witMul
  );
}

function skillWeight(rarity) {
  const tone = String(rarity ?? "normal").toLowerCase();
  // Gold (rare) skills count double; unique/normal count as 1.
  return tone === "rare" ? 2 : 1;
}

function buildSkillRarityLookup() {
  const byKey = new Map();
  for (const skill of listSkills()) {
    const rarity = String(skill.rarity ?? "normal").toLowerCase() || "normal";
    byKey.set(normalizeSkillKey(skill.name), rarity);
    for (const alias of skill.aliases ?? []) {
      byKey.set(normalizeSkillKey(alias), rarity);
    }
  }
  return byKey;
}

function lookupSkillRarity(skillName, rarityByKey) {
  const key = normalizeSkillKey(skillName);
  if (rarityByKey.has(key)) return rarityByKey.get(key);
  for (const [known, rarity] of rarityByKey.entries()) {
    if (known.includes(key) || key.includes(known)) return rarity;
  }
  return "normal";
}

function emptyRaceTally() {
  return { starts: 0, wins: 0, top3: 0 };
}

/**
 * Roster + race analytics for the website Stats page.
 * Population is tournament-wide roster count (skins = distinct identities).
 */
function buildTournamentStats(root, matches, uniqueKeys, uniqueUmas, standings) {
  const spriteLookup = buildSpriteLookup(root);
  const rarityByKey = buildSkillRarityLookup();
  const catalog = listCharacterCatalog(root);

  const rosterByKey = new Map();
  const combinedByBase = new Map();
  const skillCounts = new Map();
  const styleCounts = new Map();
  const teamPower = [];
  const trainerRows = [];
  const pickedSpriteIds = new Set();
  let filledUmaCount = 0;
  let distanceSCount = 0;
  let ugOrHigherCount = 0;

  for (const summary of listTeams(root)) {
    let team;
    try {
      team = loadTeam(root, summary.id);
    } catch {
      continue;
    }

    let totalStats = 0;
    let skillScore = 0;
    let skillCount = 0;
    let umaCount = 0;
    let uniquePickCount = 0;
    let hasOguri = false;
    let hasSmartFalcon = false;
    let hasKitasan = false;

    for (const [category, roster] of Object.entries(team.categories ?? {})) {
      (roster ?? []).forEach((member, slot) => {
        const uma = member?.uma ?? {};
        if (isPlaceholderUma(uma)) return;

        umaCount += 1;
        filledUmaCount += 1;
        totalStats += sumUmaStatsForTeamPower(uma);

        const aptitudes = uma.aptitudes ?? {};
        if (aptitudeIsS(aptitudes, "distance")) distanceSCount += 1;

        const rating = String(uma.rating ?? "").trim().toUpperCase();
        if (ratingRank(rating) <= ratingRank("UG")) ugOrHigherCount += 1;

        const styleKey = String(uma.style ?? "").toLowerCase();
        if (styleKey) styleCounts.set(styleKey, (styleCounts.get(styleKey) ?? 0) + 1);

        const baseName = baseCharacterName(uma.name);
        const baseKey = normalizeCharacterKey(baseName);
        if (/oguri/i.test(baseName)) hasOguri = true;
        if (/smartfalcon/i.test(baseKey)) hasSmartFalcon = true;
        if (/kitasanblack/i.test(baseKey)) hasKitasan = true;

        const sid = uma.spriteId ?? uma.characterId ?? null;
        if (sid != null && String(sid).trim() !== "") {
          pickedSpriteIds.add(String(sid).trim());
        }

        const skills = Array.isArray(uma.skills) ? uma.skills.filter(Boolean) : [];
        for (const skillName of skills) {
          const skillKey = normalizeSkillKey(skillName);
          const rarity = lookupSkillRarity(skillName, rarityByKey);
          skillCount += 1;
          skillScore += skillWeight(rarity);

          const prev = skillCounts.get(skillKey) ?? {
            name: skillName,
            count: 0,
            rarity,
          };
          prev.count += 1;
          if (!prev.name || prev.name.length < String(skillName).length) prev.name = skillName;
          prev.rarity = rarity;
          skillCounts.set(skillKey, prev);
        }

        const umaKey = umaIdentityKey(uma);
        const enriched = {
          ...uma,
          spriteId: uma.spriteId ?? uma.characterId ?? null,
          spritePath: resolveSpritePath(uma, spriteLookup),
        };

        if (umaKey && uniqueKeys.has(umaKey)) uniquePickCount += 1;

        if (umaKey) {
          const row = rosterByKey.get(umaKey) ?? {
            umaKey,
            umaName: enriched.name ?? "Unknown",
            baseName: baseName || enriched.name || "Unknown",
            spritePath: enriched.spritePath ?? null,
            population: 0,
            isUnique: uniqueKeys.has(umaKey),
            starts: 0,
            wins: 0,
            top3: 0,
          };
          row.population += 1;
          if (!row.spritePath && enriched.spritePath) row.spritePath = enriched.spritePath;
          if (enriched.name) row.umaName = enriched.name;
          rosterByKey.set(umaKey, row);
        }

        if (baseName) {
          const combined = combinedByBase.get(baseName.toLowerCase()) ?? {
            umaName: baseName,
            population: 0,
            skinCount: 0,
            skins: new Set(),
            spritePath: null,
          };
          combined.population += 1;
          const skinId = String(enriched.spriteId ?? enriched.name ?? "");
          if (skinId && !combined.skins.has(skinId)) {
            combined.skins.add(skinId);
            combined.skinCount = combined.skins.size;
          }
          if (!combined.spritePath && enriched.spritePath) combined.spritePath = enriched.spritePath;
          combinedByBase.set(baseName.toLowerCase(), combined);
        }

        trainerRows.push({
          teamId: team.id,
          teamName: team.name,
          teamColor: team.color,
          trainer: member.trainer ?? "Trainer",
          category,
          slot,
          umaName: enriched.name ?? "Unknown",
          rating: rating || "—",
          ratingRank: ratingRank(rating),
          spritePath: enriched.spritePath ?? null,
        });
      });
    }

    teamPower.push({
      id: team.id,
      name: team.name,
      shortName: team.shortName ?? team.name,
      color: team.color,
      umaCount,
      totalStats,
      skillCount,
      skillScore,
      uniquePickCount,
      hasOguri,
      hasSmartFalcon,
      hasKitasan,
      avgStats: umaCount > 0 ? totalStats / umaCount : 0,
    });
  }

  // Race results from standings (works even if match lineup was cleared).
  const raceByKey = new Map();
  const bumpRace = (umaKey, field) => {
    if (!umaKey) return;
    const tally = raceByKey.get(umaKey) ?? emptyRaceTally();
    tally[field] += 1;
    raceByKey.set(umaKey, tally);
  };
  const resolvePickKey = (teamId, category, slot) => {
    try {
      const { member } = getTeamMember(root, teamId, category, slot);
      return umaIdentityKey(member?.uma ?? {});
    } catch {
      return null;
    }
  };

  for (const [matchId, matchStandings] of Object.entries(standings?.matches ?? {})) {
    for (const category of CATEGORIES) {
      const placements = matchStandings?.raceResults?.[category]?.placements ?? emptyPlacements();
      const ran = Boolean(placements["1"] || placements["2"] || placements["3"]);
      if (!ran) continue;

      const matchPublic = matches.find((row) => row.id === matchId);
      const fieldRacers = matchPublic?.categories?.[category]?.racers ?? [];
      if (fieldRacers.length) {
        for (const racer of fieldRacers) bumpRace(racer.umaKey, "starts");
      } else {
        for (const place of ["1", "2", "3"]) {
          const pick = placements[place];
          if (!pick?.teamId) continue;
          bumpRace(resolvePickKey(pick.teamId, category, pick.slot), "starts");
        }
      }

      for (const place of ["1", "2", "3"]) {
        const pick = placements[place];
        if (!pick?.teamId) continue;
        const umaKey = resolvePickKey(pick.teamId, category, pick.slot);
        if (place === "1") bumpRace(umaKey, "wins");
        bumpRace(umaKey, "top3");
      }
    }
  }

  const umas = [...rosterByKey.values()]
    .map((row) => {
      const race = raceByKey.get(row.umaKey) ?? emptyRaceTally();
      const starts = race.starts;
      const wins = race.wins;
      const top3 = race.top3;
      return {
        ...row,
        starts,
        wins,
        top3,
        winRate: starts > 0 ? wins / starts : 0,
        top3Rate: starts > 0 ? top3 / starts : 0,
      };
    })
    .sort(
      (a, b) =>
        b.population - a.population ||
        b.starts - a.starts ||
        b.wins - a.wins ||
        a.umaName.localeCompare(b.umaName)
    );

  const combinedUmas = [...combinedByBase.values()]
    .map((row) => ({
      umaName: row.umaName,
      population: row.population,
      skinCount: row.skinCount,
      spritePath: row.spritePath,
    }))
    .sort((a, b) => b.population - a.population || a.umaName.localeCompare(b.umaName));

  const skillRows = [...skillCounts.values()]
    .map((row) => ({
      name: row.name,
      count: row.count,
      rarity: row.rarity,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const topSkills = skillRows.slice(0, 12);
  const rarestSkills = [...skillRows]
    .filter((row) => row.count >= 1 && row.rarity !== "unique")
    .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name))
    .slice(0, 12);

  const teamsByStats = [...teamPower].sort(
    (a, b) => b.totalStats - a.totalStats || b.skillScore - a.skillScore || a.name.localeCompare(b.name)
  );
  const teamsBySkills = [...teamPower].sort(
    (a, b) => b.skillScore - a.skillScore || b.totalStats - a.totalStats || a.name.localeCompare(b.name)
  );
  const teamsByUniquePicks = [...teamPower].sort(
    (a, b) => b.uniquePickCount - a.uniquePickCount || a.name.localeCompare(b.name)
  );

  const mostCommonUma = umas[0] ?? null;
  const mostCommonUmaCombined = combinedUmas[0] ?? null;
  const bestWinRateUma =
    [...umas]
      .filter((row) => row.starts > 0)
      .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.population - a.population || a.umaName.localeCompare(b.umaName))[0] ??
    null;

  const topRatedTrainers = [...trainerRows]
    .sort(
      (a, b) =>
        a.ratingRank - b.ratingRank ||
        a.teamName.localeCompare(b.teamName) ||
        a.trainer.localeCompare(b.trainer)
    )
    .slice(0, 5)
    .map(({ ratingRank: _rank, ...row }) => row);

  const teamSummary = (team) => ({
    id: team.id,
    name: team.name,
    color: team.color,
    shortName: team.shortName,
  });
  const teamsWithout = (predicate) =>
    teamPower
      .filter(predicate)
      .map(teamSummary)
      .sort((a, b) => a.name.localeCompare(b.name));

  const teamsWithoutOguri = teamsWithout((team) => !team.hasOguri);
  const teamsWithoutSmartFalcon = teamsWithout((team) => !team.hasSmartFalcon);
  const teamsWithoutKitasan = teamsWithout((team) => !team.hasKitasan);

  // Unpicked = catalog skins never used on any roster.
  const unpickedUmas = catalog
    .filter((entry) => {
      const base = baseCharacterName(entry.name || entry.label);
      if (!base || /^Sprite\s+/i.test(base)) return false;
      if (UNPICKED_EXCLUDE_NAMES.has(normalizeCharacterKey(base))) return false;
      const spriteId = entry.spriteId == null ? "" : String(entry.spriteId).trim();
      if (!spriteId || pickedSpriteIds.has(spriteId)) return false;
      return true;
    })
    .map((entry) => {
      const base = baseCharacterName(entry.name || entry.label);
      const variant = String(entry.variant || "Original").trim() || "Original";
      const label =
        entry.label ||
        (variant.toLowerCase() === "original" ? base : `${base} (${variant})`);
      return {
        umaName: base,
        variant,
        label,
        spriteId: String(entry.spriteId),
        spritePath: entry.spritePath ?? null,
      };
    })
    .sort(
      (a, b) =>
        a.umaName.localeCompare(b.umaName) ||
        a.variant.localeCompare(b.variant) ||
        a.label.localeCompare(b.label)
    );

  const mostPopularStyle =
    [...styleCounts.entries()]
      .map(([style, count]) => ({
        style,
        label: STYLE_LABELS[style] ?? style,
        count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0] ?? null;

  return {
    totalMatches: matches.length,
    uniqueUmaCount: uniqueUmas.length,
    filledUmaCount,
    distanceSCount,
    ugOrHigherCount,
    mostCommonUma,
    mostCommonUmaCombined,
    bestWinRateUma,
    mostUniqueTeam: teamsByUniquePicks[0] ?? null,
    mostPopularStyle,
    uniqueUmas: uniqueUmas.map((row) => row.umaName),
    uniqueUmaKeys: uniqueUmas.map((row) => row.umaKey),
    umas,
    combinedUmas,
    popularity: umas.map((row) => ({
      umaName: row.umaName,
      starts: row.starts || row.population,
      wins: row.wins,
      winRate: row.winRate,
    })),
    topSkills,
    rarestSkills,
    teamsByStats,
    teamsBySkills,
    teamsByUniquePicks,
    statsLeader: teamsByStats[0] ?? null,
    skillsLeader: teamsBySkills[0] ?? null,
    topRatedTrainers,
    teamsWithoutOguri,
    teamsWithoutSmartFalcon,
    teamsWithoutKitasan,
    unpickedUmas,
  };
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
  const data = buildWebsiteData(root, standings);
  publishWebsiteSprites(root, data);
  fs.writeFileSync(publicPath, JSON.stringify(data, null, 2) + "\n");
}

export function rebuildWebsitePublic(root) {
  const standings = readStandings(root);
  const publicPath = path.join(root, WEBSITE_PUBLIC_REL);
  fs.mkdirSync(path.dirname(publicPath), { recursive: true });
  const data = buildWebsiteData(root, standings);
  const spriteResult = publishWebsiteSprites(root, data);
  const teamResult = publishWebsiteTeams(root);
  const runstyleResult = publishWebsiteRunstyles(root);
  const skillResult = publishWebsiteSkills(root);
  fs.writeFileSync(publicPath, JSON.stringify(data, null, 2) + "\n");
  return {
    copied: spriteResult.copied,
    teams: teamResult.teams,
    runstyles: runstyleResult.copied,
    skills: skillResult.count,
  };
}

function buildWebsiteData(root, standings) {
  const spriteLookup = buildSpriteLookup(root);
  const { uniqueKeys, uniqueUmas } = buildRosterUniqueIndex(root);
  const teams = buildWebsiteTeams(root).map((team) => ({
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    tagline: team.tagline ?? "",
    color: team.color,
    categories: team.categories,
  }));

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
          umaKey: racer.umaKey,
          isUnique: Boolean(racer.umaKey && uniqueKeys.has(racer.umaKey)),
          spritePath: racer.uma.spritePath,
          style: racer.uma.style ?? null,
          key: racer.key,
        }));
        const racerByKey = Object.fromEntries(racers.map((racer) => [racer.key, racer]));
        const placements = raceResults?.[category]?.placements ?? emptyPlacements();
        const enrichedPlacements = Object.fromEntries(
          ["1", "2", "3"].map((place) => {
            const pick = placements?.[place];
            if (!pick?.teamId) return [place, null];
            const key = entryKey(pick.teamId, pick.slot);
            if (racerByKey[key]) return [place, racerByKey[key]];
            try {
              const racer = resolveRacer(root, pick, category, spriteLookup);
              return [
                place,
                {
                  teamId: racer.teamId,
                  teamName: racer.teamName,
                  teamColor: racer.teamColor,
                  slot: racer.slot,
                  gate: racer.gate,
                  trainer: racer.trainer,
                  umaName: racer.umaName,
                  umaKey: racer.umaKey,
                  isUnique: Boolean(racer.umaKey && uniqueKeys.has(racer.umaKey)),
                  spritePath: racer.uma.spritePath,
                  style: racer.uma.style ?? null,
                  key: racer.key,
                },
              ];
            } catch {
              return [place, null];
            }
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

  return {
    tournament: standings.tournament ?? "Bunny Invitational",
    updatedAt: standings.updatedAt,
    scoring: standings.scoring,
    standings: Object.entries(standings.teams ?? {})
      .map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => b.points - a.points || b.firsts - a.firsts),
    teams,
    matches,
    stats: buildTournamentStats(root, matches, uniqueKeys, uniqueUmas, standings),
  };
}


function loadMatchRacers(root, matchId, category) {
  return resolveMatchRacers(root, matchId, category).map((racer) => ({
    teamId: racer.teamId,
    slot: racer.slot,
    gate: racer.gate ?? null,
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
      gate: racer.gate ?? null,
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
  const matchPath = path.join(root, "data", "matches", `${matchId}.json`);
  if (!fs.existsSync(matchPath)) throw new Error(`Match not found: ${matchId}`);

  const match = JSON.parse(fs.readFileSync(matchPath, "utf8"));
  let dirty = false;

  if (!standings.matches[matchId]) {
    standings.matches[matchId] = {
      day: match.day,
      matchNumber: match.matchNumber,
      round: match.round,
      teams: match.teams,
      raceResults: emptyRaceResults(),
    };
    dirty = true;
  } else {
    const row = standings.matches[matchId];
    if (
      row.day !== match.day ||
      row.matchNumber !== match.matchNumber ||
      row.round !== match.round ||
      JSON.stringify(row.teams) !== JSON.stringify(match.teams)
    ) {
      row.day = match.day;
      row.matchNumber = match.matchNumber;
      row.round = match.round;
      row.teams = match.teams;
      dirty = true;
    }
  }

  const beforeTeams = Object.keys(standings.teams).length;
  ensureTeamRows(root, standings, match.teams);
  if (Object.keys(standings.teams).length !== beforeTeams) dirty = true;

  if (dirty) writeStandings(root, standings);
  return standings;
}

function ensureTeamRows(root, standings, teamIds) {
  for (const teamId of teamIds ?? []) {
    if (!teamId || standings.teams[teamId]) continue;
    const team = loadTeam(root, teamId);
    standings.teams[teamId] = {
      name: team.name,
      color: team.color,
      firsts: 0,
      seconds: 0,
      thirds: 0,
      uniqueBonuses: 0,
      points: 0,
    };
  }
}

function recalculateStandings(root, standings) {
  for (const match of Object.values(standings.matches ?? {})) {
    ensureTeamRows(root, standings, match.teams);
    for (const category of CATEGORIES) {
      const placements = match.raceResults?.[category]?.placements ?? emptyPlacements();
      for (const place of ["1", "2", "3"]) {
        const pick = placements[place];
        if (pick?.teamId) ensureTeamRows(root, standings, [pick.teamId]);
      }
    }
  }

  for (const teamId of Object.keys(standings.teams)) {
    standings.teams[teamId].firsts = 0;
    standings.teams[teamId].seconds = 0;
    standings.teams[teamId].thirds = 0;
    standings.teams[teamId].uniqueBonuses = 0;
    standings.teams[teamId].points = 0;
  }

  const placePoints = standings.scoring.place;
  const uniqueBonus = Number(standings.scoring.uniqueBonus ?? DEFAULT_SCORING.uniqueBonus) || 0;
  const { uniqueKeys } = buildRosterUniqueIndex(root);

  for (const match of Object.values(standings.matches)) {
    for (const category of CATEGORIES) {
      const placements = match.raceResults?.[category]?.placements ?? emptyPlacements();
      for (const place of ["1", "2", "3"]) {
        const pick = placements[place];
        if (!pick?.teamId || !standings.teams[pick.teamId]) continue;

        let pts = placePoints[place] ?? 0;
        if (uniqueBonus > 0 && isUniqueMember(root, uniqueKeys, pick.teamId, category, pick.slot)) {
          pts += uniqueBonus;
          standings.teams[pick.teamId].uniqueBonuses += 1;
        }

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
  recalculateStandings(root, standings);
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
  recalculateStandings(root, standings);
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
    sceneTransition: extras.sceneTransition ?? false,
    startingSoon: extras.startingSoon ?? false,
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
