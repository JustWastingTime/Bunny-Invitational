import fs from "node:fs";
import path from "node:path";
import { buildSpriteLookup, resolveSpritePath } from "./sprite-resolver.js";
import { getTeam, listTeams } from "./team-editor.js";

const WEBSITE_SPRITE_DIR = "website/assets/characters";
const WEBSITE_TEAMS_DIR = "website/data/teams";
const WEBSITE_RUNSTYLE_DIR = "website/assets/runstyle";
const RUNSTYLE_FILES = ["runaway", "front", "pace", "late", "end"];

function sourcePathFromWebPath(root, webPath) {
  const relative = String(webPath ?? "").replace(/^\/+/, "");
  if (!relative.startsWith("assets/characters/")) return null;
  return path.join(root, relative);
}

export function websiteSpritePath(filename) {
  return `assets/characters/${filename}`;
}

function normalizeAptitudes(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    terrain: String(src.terrain ?? src.turf ?? "A").toUpperCase(),
    distance: String(src.distance ?? "A").toUpperCase(),
    style: String(src.style ?? "A").toUpperCase(),
  };
}

export function enrichUmaForWebsite(uma, spriteLookup) {
  const webPath = resolveSpritePath(uma, spriteLookup);
  return {
    ...uma,
    spriteId: uma.spriteId ?? uma.characterId ?? null,
    spritePath: webPath,
    aptitudes: normalizeAptitudes(uma.aptitudes),
  };
}

export function enrichTeamForWebsite(team, spriteLookup) {
  const categories = {};
  for (const [category, roster] of Object.entries(team.categories ?? {})) {
    categories[category] = (roster ?? []).map((member, slot) => ({
      slot,
      trainer: member.trainer,
      locked: Boolean(member.locked),
      uma: enrichUmaForWebsite(member.uma ?? {}, spriteLookup),
    }));
  }
  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName ?? team.name,
    tagline: team.tagline ?? "",
    color: team.color,
    categories,
  };
}

export function collectSpriteWebPaths(publicData) {
  const paths = new Set();

  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.spritePath === "string" && value.spritePath.trim()) {
      paths.add(value.spritePath.trim());
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  }

  visit(publicData);
  return [...paths];
}

function copySpriteFile(root, webPath, copied) {
  const src = sourcePathFromWebPath(root, webPath);
  if (!src || !fs.existsSync(src)) return null;
  const filename = path.basename(src);
  const destDir = path.join(root, WEBSITE_SPRITE_DIR);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, filename));
  const relative = websiteSpritePath(filename);
  copied.set(webPath, relative);
  return relative;
}

function rewriteSpritePaths(value, copied) {
  if (!value || typeof value !== "object") return;
  if (typeof value.spritePath === "string") {
    const next = copied.get(value.spritePath.trim());
    if (next) value.spritePath = next;
  }
  if (Array.isArray(value)) {
    for (const item of value) rewriteSpritePaths(item, copied);
    return;
  }
  for (const child of Object.values(value)) rewriteSpritePaths(child, copied);
}

/**
 * Copy referenced character portraits into website/assets/characters and rewrite
 * spritePath values to relative URLs that work on GitHub Pages.
 */
export function publishWebsiteSprites(root, publicData) {
  const copied = new Map();
  for (const webPath of collectSpriteWebPaths(publicData)) {
    copySpriteFile(root, webPath, copied);
  }
  rewriteSpritePaths(publicData, copied);
  return { copied: copied.size, destDir: path.join(root, WEBSITE_SPRITE_DIR) };
}

export function publishWebsiteRunstyles(root) {
  const destDir = path.join(root, WEBSITE_RUNSTYLE_DIR);
  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;
  for (const name of RUNSTYLE_FILES) {
    const src = path.join(root, "assets/runstyle", `${name}.png`);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(destDir, `${name}.png`));
    copied += 1;
  }
  return { copied, destDir };
}

export function publishWebsiteTeams(root) {
  const spriteLookup = buildSpriteLookup(root);
  const destDir = path.join(root, WEBSITE_TEAMS_DIR);
  fs.mkdirSync(destDir, { recursive: true });

  const copied = new Map();
  const index = [];

  for (const row of listTeams(root)) {
    const team = enrichTeamForWebsite(getTeam(root, row.id), spriteLookup);

    function copyTeamSprites(value) {
      if (!value || typeof value !== "object") return;
      if (typeof value.spritePath === "string" && value.spritePath.startsWith("/")) {
        const relative = copySpriteFile(root, value.spritePath, copied);
        if (relative) value.spritePath = relative;
      }
      if (Array.isArray(value)) return value.forEach(copyTeamSprites);
      Object.values(value).forEach(copyTeamSprites);
    }
    copyTeamSprites(team);

    fs.writeFileSync(
      path.join(destDir, `${team.id}.json`),
      JSON.stringify(team, null, 2) + "\n"
    );
    index.push({
      id: team.id,
      name: team.name,
      shortName: team.shortName,
      tagline: team.tagline,
      color: team.color,
    });
  }

  index.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(destDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return { teams: index.length, sprites: copied.size, destDir };
}

export function buildWebsiteTeams(root) {
  const spriteLookup = buildSpriteLookup(root);
  return listTeams(root)
    .map((row) => enrichTeamForWebsite(getTeam(root, row.id), spriteLookup))
    .sort((a, b) => a.name.localeCompare(b.name));
}
