import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRACKET_MATCHES, emptyMatch } from "../server/match-editor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function writeMatch(match) {
  const outPath = path.join(ROOT, "data", "matches", `${match.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(match, null, 2) + "\n");
  return outPath;
}

function clearStandings() {
  const standings = {
    tournament: "Bunny Invitational",
    updatedAt: new Date().toISOString(),
    scoring: { place: { "1": 5, "2": 3, "3": 1 }, uniqueBonus: 1 },
    teams: {},
    matches: {},
  };
  const standingsPath = path.join(ROOT, "data", "standings.json");
  fs.writeFileSync(standingsPath, JSON.stringify(standings, null, 2) + "\n");

  const websiteStandings = path.join(ROOT, "website", "data", "standings.json");
  fs.mkdirSync(path.dirname(websiteStandings), { recursive: true });
  fs.writeFileSync(websiteStandings, JSON.stringify(standings, null, 2) + "\n");
}

function updateBracketLayout() {
  const layoutPath = path.join(ROOT, "website", "data", "bracket-layout.json");
  const layout = JSON.parse(fs.readFileSync(layoutPath, "utf8"));
  const byBattle = Object.fromEntries(BRACKET_MATCHES.map((row) => [row.battleId, row.id]));
  layout.battles = (layout.battles ?? []).map((battle) => ({
    ...battle,
    matchId: byBattle[battle.id] ?? battle.matchId ?? null,
  }));
  fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2) + "\n");
}

function main() {
  const matchesDir = path.join(ROOT, "data", "matches");
  fs.mkdirSync(matchesDir, { recursive: true });

  for (const row of BRACKET_MATCHES) {
    const match = emptyMatch({
      id: row.id,
      day: row.day,
      matchNumber: row.matchNumber,
      round: row.label,
      teams: ["", "", ""],
    });
    console.log(`Wrote ${writeMatch(match)}`);
  }

  clearStandings();
  console.log("Cleared standings / match results");

  updateBracketLayout();
  console.log("Updated website/data/bracket-layout.json matchIds");
}

main();
