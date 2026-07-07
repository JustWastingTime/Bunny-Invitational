import fs from "node:fs";
import path from "node:path";

const IMAGE_EXTS = new Set([".png", ".webp", ".jpg", ".jpeg"]);
const DEFAULT_CHARACTER_JSON =
  "D:/Documents/Uma/TazunaBot/TazunaDiscordBot/assets/character.json";

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseSpriteIdFromFilename(name) {
  const base = path.basename(name, path.extname(name));
  const parts = base.match(/\d+/g) ?? [];
  return parts.length ? parts[parts.length - 1] : null;
}

export function readSpriteFiles(spriteDir) {
  if (!fs.existsSync(spriteDir)) return [];

  return fs
    .readdirSync(spriteDir)
    .filter((name) => IMAGE_EXTS.has(path.extname(name).toLowerCase()))
    .map((file) => {
      const spriteId = parseSpriteIdFromFilename(file);
      if (!spriteId) return null;
      return {
        file,
        spriteId,
        webPath: `/assets/characters/${file}`,
      };
    })
    .filter(Boolean);
}

function readCharacterRecords(characterJsonPath) {
  if (!fs.existsSync(characterJsonPath)) return [];

  const source = JSON.parse(fs.readFileSync(characterJsonPath, "utf8"));
  if (!Array.isArray(source)) return [];

  return source
    .map((row) => {
      const raw = String(row.id ?? "");
      const match = raw.match(/^(\d+)\s*-\s*(.+)$/);
      if (!match) return null;

      const spriteId = match[1];
      const variant = String(row.type ?? "").trim();
      const characterName = String(row.character_name ?? match[2]).trim();

      return {
        spriteId,
        characterName,
        variant,
        displayName: variant ? `${characterName} (${variant})` : characterName,
      };
    })
    .filter(Boolean);
}

export function buildSpriteLookup(root, options = {}) {
  const spriteDir = path.join(root, "assets", "characters");
  const characterJsonPath = options.characterJsonPath ?? DEFAULT_CHARACTER_JSON;
  const spriteMapPath = path.join(root, "data", "sprite-map.json");

  const bySpriteId = new Map();
  const byCharacterName = new Map();
  const byDisplayName = new Map();

  for (const sprite of readSpriteFiles(spriteDir)) {
    bySpriteId.set(sprite.spriteId, sprite.webPath);
  }

  // Enrich with character.json names (preferred Original variant per character).
  for (const row of readCharacterRecords(characterJsonPath)) {
    const webPath = bySpriteId.get(row.spriteId);
    if (!webPath) continue;

    const charKey = normalizeName(row.characterName);
    const displayKey = normalizeName(row.displayName);
    const isOriginal = row.variant.toLowerCase() === "original";

    if (charKey && (!byCharacterName.has(charKey) || isOriginal)) {
      byCharacterName.set(charKey, webPath);
    }
    if (displayKey) byDisplayName.set(displayKey, webPath);
  }

  // Fallback: sprite-map.json metadata (if present).
  if (fs.existsSync(spriteMapPath)) {
    try {
      const spriteMap = JSON.parse(fs.readFileSync(spriteMapPath, "utf8"));
      for (const row of Object.values(spriteMap.bySpriteId ?? {})) {
        if (!row?.spriteId || !row?.file) continue;
        const webPath = `/assets/characters/${row.file}`;
        bySpriteId.set(String(row.spriteId), webPath);

        const charKey = normalizeName(row.characterName);
        const displayKey = normalizeName(row.displayName);
        const isOriginal = String(row.variant ?? "").toLowerCase() === "original";

        if (charKey && (!byCharacterName.has(charKey) || isOriginal)) {
          byCharacterName.set(charKey, webPath);
        }
        if (displayKey) byDisplayName.set(displayKey, webPath);
      }
    } catch {
      // ignore broken sprite-map
    }
  }

  return { bySpriteId, byCharacterName, byDisplayName };
}

export function resolveSpritePath(uma, lookup) {
  const rawId = uma.spriteId ?? uma.characterId ?? uma.id ?? null;
  const rawIdStr = rawId == null ? "" : String(rawId).trim();

  if (rawIdStr && lookup.bySpriteId.has(rawIdStr)) {
    return lookup.bySpriteId.get(rawIdStr);
  }

  const nameKey = normalizeName(uma.name);
  const slugKey = normalizeName(String(uma.characterId ?? ""));
  const displayOriginalKey = normalizeName(`${uma.name ?? ""} (Original)`);

  return (
    lookup.byDisplayName.get(displayOriginalKey) ??
    lookup.byCharacterName.get(nameKey) ??
    lookup.byCharacterName.get(slugKey) ??
    null
  );
}
