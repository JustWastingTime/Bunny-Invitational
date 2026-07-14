import path from "node:path";
import { fileURLToPath } from "node:url";
import { listMatchFiles, ensureStandingsForMatch, rebuildWebsitePublic } from "../server/tournament.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function main() {
  const matchesDir = path.join(ROOT, "data", "matches");
  for (const matchId of listMatchFiles(matchesDir)) {
    ensureStandingsForMatch(ROOT, matchId);
  }
  const result = rebuildWebsitePublic(ROOT);
  console.log("Wrote website/data/public.json");
  console.log(`Copied ${result.copied} portraits to website/assets/characters/`);
}

main();
