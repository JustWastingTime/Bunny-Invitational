import fs from "node:fs";

const DEFAULT_SKILL_JSON =
  "D:/Documents/Uma/TazunaBot/TazunaDiscordBot/assets/skill.json";

export function listSkills(options = {}) {
  const skillJsonPath = options.skillJsonPath ?? DEFAULT_SKILL_JSON;
  if (!fs.existsSync(skillJsonPath)) return [];

  const source = JSON.parse(fs.readFileSync(skillJsonPath, "utf8"));
  if (!Array.isArray(source)) return [];

  const byName = new Map();
  for (const row of source) {
    const name = String(row.skill_name ?? "").trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, {
      name,
      rarity: String(row.rarity ?? "").trim() || "normal",
      category: String(row.category ?? "").trim() || "",
      aliases: Array.isArray(row.aliases)
        ? row.aliases.map((alias) => String(alias).trim()).filter(Boolean)
        : [],
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
