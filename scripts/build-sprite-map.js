import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHARACTER_JSON_PATH =
  process.argv[2] ?? "D:/Documents/Uma/TazunaBot/TazunaDiscordBot/assets/character.json";
const SPRITE_DIR = path.join(ROOT, "assets", "characters");
const OUT_PATH = path.join(ROOT, "data", "sprite-map.json");

function parseCharacterJsonId(idValue) {
  const raw = String(idValue ?? "");
  const match = raw.match(/^(\d+)\s*-\s*(.+)$/);
  if (!match) return { spriteId: null, title: raw.trim() };
  return { spriteId: match[1], title: match[2].trim() };
}

function readCharacterRecords() {
  const source = JSON.parse(fs.readFileSync(CHARACTER_JSON_PATH, "utf8"));
  if (!Array.isArray(source)) {
    throw new Error("character.json is expected to be an array.");
  }

  return source
    .map((row) => {
      const parsed = parseCharacterJsonId(row.id);
      if (!parsed.spriteId) return null;
      const variant = String(row.type ?? "").trim();
      const charName = String(row.character_name ?? parsed.title).trim();
      const displayName = variant ? `${charName} (${variant})` : charName;

      return {
        spriteId: parsed.spriteId,
        umaId: parsed.spriteId.slice(0, 4),
        characterName: charName,
        variant,
        displayName,
        costume: String(row.costume ?? "").trim(),
        sourceTitle: parsed.title,
      };
    })
    .filter(Boolean);
}

function readSpriteFiles() {
  if (!fs.existsSync(SPRITE_DIR)) return [];

  return fs
    .readdirSync(SPRITE_DIR)
    .filter((name) => /\.(png|webp|jpg|jpeg)$/i.test(name))
    .map((name) => {
      const base = path.basename(name, path.extname(name));
      const parts = base.match(/\d+/g) ?? [];
      const spriteId = parts.length ? parts[parts.length - 1] : null;
      const umaId = parts.length > 1 ? parts[parts.length - 2] : null;
      return { file: name, spriteId, umaId };
    })
    .filter((row) => row.spriteId);
}

function buildMap() {
  const characterRows = readCharacterRecords();
  const spriteFiles = readSpriteFiles();

  const bySpriteId = {};
  for (const row of characterRows) {
    bySpriteId[row.spriteId] = {
      spriteId: row.spriteId,
      umaId: row.umaId,
      characterName: row.characterName,
      variant: row.variant,
      displayName: row.displayName,
      costume: row.costume,
      file: null,
    };
  }

  for (const sprite of spriteFiles) {
    const current = bySpriteId[sprite.spriteId] ?? {
      spriteId: sprite.spriteId,
      umaId: sprite.umaId ?? sprite.spriteId.slice(0, 4),
      characterName: null,
      variant: null,
      displayName: null,
      costume: null,
      file: null,
    };
    current.file = sprite.file;
    if (!current.umaId && sprite.umaId) current.umaId = sprite.umaId;
    bySpriteId[sprite.spriteId] = current;
  }

  const byUmaId = {};
  for (const spriteId of Object.keys(bySpriteId).sort()) {
    const umaId = bySpriteId[spriteId].umaId ?? "unknown";
    if (!byUmaId[umaId]) byUmaId[umaId] = [];
    byUmaId[umaId].push(spriteId);
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceCharacterJson: CHARACTER_JSON_PATH,
    spriteFolder: "assets/characters",
    totals: {
      characterRows: characterRows.length,
      spriteFiles: spriteFiles.length,
      mappedSpriteIds: Object.keys(bySpriteId).length,
    },
    bySpriteId,
    byUmaId,
  };
}

function main() {
  const map = buildMap();
  fs.writeFileSync(OUT_PATH, JSON.stringify(map, null, 2) + "\n");
  console.log(`Wrote ${OUT_PATH}`);
  console.log(
    `Mapped ${map.totals.mappedSpriteIds} sprite IDs (${map.totals.spriteFiles} files in assets/characters)`
  );
}

main();
