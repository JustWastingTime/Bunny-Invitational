import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STATE_PATH = path.join(ROOT, "data", "overlay-state.json");
const action = String(process.argv[2] ?? "status").toLowerCase();

function readState() {
  if (!fs.existsSync(STATE_PATH)) return { visible: true };
  try {
    const data = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return { visible: data.visible !== false };
  } catch {
    return { visible: true };
  }
}

function writeState(visible) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ visible: Boolean(visible) }, null, 2) + "\n");
}

const state = readState();
let nextVisible = state.visible;

if (action === "show") nextVisible = true;
else if (action === "hide") nextVisible = false;
else if (action === "toggle") nextVisible = !state.visible;
else if (action !== "status") {
  console.error("Usage: node scripts/set-overlay-visibility.js [show|hide|toggle|status]");
  process.exit(1);
}

if (action !== "status") writeState(nextVisible);

console.log(`Overlay visible: ${nextVisible ? "ON" : "OFF"}`);
