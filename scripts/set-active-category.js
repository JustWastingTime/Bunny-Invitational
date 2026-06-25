import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CATEGORIES = ["sprint", "mile", "medium", "long", "dirt"];

const category = String(process.argv[2] ?? "").toLowerCase();
if (!CATEGORIES.includes(category)) {
  console.error(`Usage: node scripts/set-active-category.js <${CATEGORIES.join("|")}>`);
  process.exit(1);
}

const configPath = path.join(ROOT, "data", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const matchPath = path.join(ROOT, "data", "matches", `${config.activeMatch}.json`);

if (!fs.existsSync(matchPath)) {
  console.error(`Active match file not found: ${matchPath}`);
  process.exit(1);
}

const match = JSON.parse(fs.readFileSync(matchPath, "utf8"));
match.activeCategory = category;
fs.writeFileSync(matchPath, JSON.stringify(match, null, 2) + "\n");

console.log(`Active match: ${config.activeMatch}`);
console.log(`Category set to: ${category}`);
