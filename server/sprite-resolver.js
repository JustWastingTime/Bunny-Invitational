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
  const match = base.match(/chara_stand_\d+_(\d+)/i);
  if (match) return match[1];
  const parts = base.match(/\d+/g) ?? [];
  return parts.length ? parts[parts.length - 1] : null;
}

function parseSpriteIdFromThumbnail(thumbnail) {
  const match = String(thumbnail ?? "").match(/chara_stand_\d+_(\d+)\./i);
  return match ? match[1] : null;
}

function parseCharacterJsonRow(row) {
  const raw = String(row.id ?? "");
  const match = raw.match(/^(\d+)\s*-\s*(.+)$/);
  if (!match) return null;

  const costumeId = match[1];
  const portraitSpriteId =
    parseSpriteIdFromThumbnail(row.thumbnail) ?? costumeId;
  const variant = String(row.type ?? "").trim();
  const characterName = String(row.character_name ?? match[2]).trim();

  return {
    costumeId,
    portraitSpriteId,
    characterName,
    variant,
    displayName: variant ? `${characterName} (${variant})` : characterName,
    costume: String(row.costume ?? "").trim(),
  };
}

export function assignCatalogKeys(rows) {
  const portraitCounts = new Map();
  for (const row of rows) {
    portraitCounts.set(
      row.portraitSpriteId,
      (portraitCounts.get(row.portraitSpriteId) ?? 0) + 1
    );
  }

  return rows.map((row) => ({
    ...row,
    spriteId:
      (portraitCounts.get(row.portraitSpriteId) ?? 0) > 1
        ? row.costumeId
        : row.portraitSpriteId,
  }));
}

export function resolvePortraitPath(row, spritesById) {
  if (spritesById.has(row.spriteId)) return spritesById.get(row.spriteId);
  if (spritesById.has(row.portraitSpriteId)) {
    return spritesById.get(row.portraitSpriteId);
  }
  if (spritesById.has(row.costumeId)) return spritesById.get(row.costumeId);
  return null;
}

export function readCharacterRecords(characterJsonPath) {
  if (!fs.existsSync(characterJsonPath)) return [];

  const source = JSON.parse(fs.readFileSync(characterJsonPath, "utf8"));
  if (!Array.isArray(source)) return [];

  return source.map(parseCharacterJsonRow).filter(Boolean);
}

export function readSpriteFiles(spriteDir) {
  if (!fs.existsSync(spriteDir)) return [];

  return fs
    .readdirSync(spriteDir)
    .filter((name) => !/\(\d+\)\./.test(name))
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
  for (const row of assignCatalogKeys(readCharacterRecords(characterJsonPath))) {
    const webPath = resolvePortraitPath(row, bySpriteId);
    if (!webPath) continue;

    bySpriteId.set(row.spriteId, webPath);

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

/** Catalog of uma variants for the dashboard team editor. */
export function listCharacterCatalog(root, options = {}) {
  const spriteDir = path.join(root, "assets", "characters");
  const characterJsonPath = options.characterJsonPath ?? DEFAULT_CHARACTER_JSON;
  const spriteMapPath = path.join(root, "data", "sprite-map.json");

  const spritesById = new Map();
  for (const sprite of readSpriteFiles(spriteDir)) {
    spritesById.set(sprite.spriteId, sprite.webPath);
  }

  if (fs.existsSync(spriteMapPath)) {
    try {
      const spriteMap = JSON.parse(fs.readFileSync(spriteMapPath, "utf8"));
      for (const row of Object.values(spriteMap.bySpriteId ?? {})) {
        if (!row?.spriteId || !row?.file) continue;
        spritesById.set(String(row.spriteId), `/assets/characters/${row.file}`);
      }
    } catch {
      // ignore
    }
  }

  const bySpriteId = new Map();

  for (const row of assignCatalogKeys(readCharacterRecords(characterJsonPath))) {
    bySpriteId.set(row.spriteId, {
      spriteId: row.spriteId,
      name: row.characterName,
      variant: row.variant || "Original",
      label: row.displayName,
      spritePath: resolvePortraitPath(row, spritesById),
    });
  }

  if (fs.existsSync(spriteMapPath)) {
    try {
      const spriteMap = JSON.parse(fs.readFileSync(spriteMapPath, "utf8"));
      for (const row of Object.values(spriteMap.bySpriteId ?? {})) {
        if (!row?.spriteId || !row?.displayName) continue;
        const spriteId = String(row.spriteId);
        if (bySpriteId.has(spriteId)) continue;
        bySpriteId.set(spriteId, {
          spriteId,
          name: row.characterName ?? row.displayName,
          variant: row.variant || "Original",
          label: row.displayName,
          spritePath: spritesById.get(spriteId) ?? null,
        });
      }
    } catch {
      // ignore
    }
  }

  // Include local sprites that aren't in character.json or sprite-map
  for (const [spriteId, spritePath] of spritesById.entries()) {
    if (bySpriteId.has(spriteId)) continue;
    bySpriteId.set(spriteId, {
      spriteId,
      name: `Sprite ${spriteId}`,
      variant: "Unknown",
      label: `Sprite ${spriteId}`,
      spritePath,
    });
  }

  return [...bySpriteId.values()].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    if (a.variant.toLowerCase() === "original") return -1;
    if (b.variant.toLowerCase() === "original") return 1;
    return a.variant.localeCompare(b.variant) || a.spriteId.localeCompare(b.spriteId);
  });
}
