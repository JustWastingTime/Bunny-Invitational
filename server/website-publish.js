import fs from "node:fs";
import path from "node:path";

const WEBSITE_SPRITE_DIR = "website/assets/characters";

function sourcePathFromWebPath(root, webPath) {
  const relative = String(webPath ?? "").replace(/^\/+/, "");
  if (!relative.startsWith("assets/characters/")) return null;
  return path.join(root, relative);
}

export function websiteSpritePath(filename) {
  return `assets/characters/${filename}`;
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

/**
 * Copy referenced character portraits into website/assets/characters and rewrite
 * spritePath values to relative URLs that work on GitHub Pages.
 */
export function publishWebsiteSprites(root, publicData) {
  const destDir = path.join(root, WEBSITE_SPRITE_DIR);
  fs.mkdirSync(destDir, { recursive: true });

  const copied = new Map();
  for (const webPath of collectSpriteWebPaths(publicData)) {
    const src = sourcePathFromWebPath(root, webPath);
    if (!src || !fs.existsSync(src)) continue;
    const filename = path.basename(src);
    const dest = path.join(destDir, filename);
    fs.copyFileSync(src, dest);
    copied.set(webPath, websiteSpritePath(filename));
  }

  function rewrite(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.spritePath === "string") {
      const next = copied.get(value.spritePath.trim());
      if (next) value.spritePath = next;
    }
    if (Array.isArray(value)) {
      for (const item of value) rewrite(item);
      return;
    }
    for (const child of Object.values(value)) rewrite(child);
  }

  rewrite(publicData);
  return { copied: copied.size, destDir };
}
