/**
 * Scaffold a new match JSON with empty gate slots.
 * Usage: node scripts/new-match.js day1-match02 uma-club-a uma-club-b dust-bunny
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const [matchId, team1, team2, team3, day = "1", matchNum = "1"] = process.argv.slice(2);

if (!matchId || !team1 || !team2 || !team3) {
  console.error("Usage: node scripts/new-match.js <match-id> <team1> <team2> <team3> [day] [matchNumber]");
  process.exit(1);
}

const teams = [team1, team2, team3];
const categories = ["sprint", "mile", "medium", "long", "dirt"];

function makeEntries() {
  const entries = [];
  for (const teamId of teams) {
    for (let slot = 0; slot < 3; slot++) {
      entries.push({ teamId, slot, gate: null });
    }
  }
  return entries;
}

const match = {
  id: matchId,
  day: Number(day),
  matchNumber: Number(matchNum),
  round: "Qualification Round",
  teams,
  activeCategory: "sprint",
  races: Object.fromEntries(categories.map((cat) => [cat, makeEntries()])),
};

const outPath = path.join(ROOT, "data", "matches", `${matchId}.json`);
fs.writeFileSync(outPath, JSON.stringify(match, null, 2) + "\n");
console.log(`Created ${outPath}`);
