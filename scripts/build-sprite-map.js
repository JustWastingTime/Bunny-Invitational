import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignCatalogKeys,
  readCharacterRecords,
  readSpriteFiles,
  resolvePortraitPath,
} from "../server/sprite-resolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHARACTER_JSON_PATH =
  process.argv[2] ?? "D:/Documents/Uma/TazunaBot/TazunaDiscordBot/assets/character.json";
const SPRITE_DIR = path.join(ROOT, "assets", "characters");
const OUT_PATH = path.join(ROOT, "data", "sprite-map.json");

function buildMap() {
  const characterRows = assignCatalogKeys(
    readCharacterRecords(CHARACTER_JSON_PATH)
  );
  const spriteFiles = readSpriteFiles(SPRITE_DIR);

  const spritesById = new Map();
  for (const sprite of spriteFiles) {
    spritesById.set(sprite.spriteId, sprite.webPath);
  }

  const bySpriteId = {};
  for (const row of characterRows) {
    const webPath = resolvePortraitPath(row, spritesById);
    bySpriteId[row.spriteId] = {
      spriteId: row.spriteId,
      umaId: row.spriteId.slice(0, 4),
      characterName: row.characterName,
      variant: row.variant,
      displayName: row.displayName,
      costume: row.costume,
      file: webPath ? path.basename(webPath) : null,
    };
  }

  for (const sprite of spriteFiles) {
    if (bySpriteId[sprite.spriteId]) continue;
    bySpriteId[sprite.spriteId] = {
      spriteId: sprite.spriteId,
      umaId: sprite.umaId ?? sprite.spriteId.slice(0, 4),
      characterName: null,
      variant: null,
      displayName: null,
      costume: null,
      file: sprite.file,
    };
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
