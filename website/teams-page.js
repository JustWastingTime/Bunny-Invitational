const CATEGORY_ORDER = ["sprint", "mile", "medium", "long", "dirt"];

const STAT_KEYS = [
  { key: "speed", label: "SPD", icon: "Speed" },
  { key: "stamina", label: "STA", icon: "Stamina" },
  { key: "power", label: "POW", icon: "Power" },
  { key: "guts", label: "GUT", icon: "Guts" },
  { key: "wisdom", label: "WIT", icon: "Wit" },
];

const APTITUDE_ROWS = [
  { key: "terrain", label: "Surface" },
  { key: "distance", label: "Distance" },
  { key: "style", label: "Style" },
];

const STYLE_LABELS = {
  runaway: "Runaway",
  front: "Front Runner",
  pace: "Pace Chaser",
  late: "Late Surger",
  end: "End Closer",
};

function gradeIconName(grade) {
  const letter = String(grade ?? "").trim().toUpperCase();
  return letter ? `Rank_${letter}` : "Rank_G";
}

let teamIndex = [];
const teamCache = new Map();
const openTeamIds = new Set();
let selectedMemberKey = null;
let teamsBooted = false;
let skillRarityByName = new Map();

function normalizeSkillKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[◎○◯★☆♪]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resolveAssetPath(spritePath) {
  if (!spritePath) return null;
  if (/^https?:\/\//i.test(spritePath)) return spritePath;
  if (spritePath.startsWith("assets/")) return `./${spritePath}`;
  const file = String(spritePath).split("/").pop();
  return file ? `./assets/characters/${file}` : null;
}

function iconPath(folder, name) {
  return `./assets/icons/${folder}/${encodeURIComponent(name)}.png`;
}

function iconImg(folder, name, className, alt = "") {
  const safeName = escapeHtml(name);
  const src = iconPath(folder, name);
  return `<img class="${className}" src="${src}" alt="${escapeHtml(alt || name)}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${className} fallback',textContent:'${safeName}'}))" />`;
}

function memberKey(teamId, category, slot) {
  return `${teamId}:${category}:${slot}`;
}

function parseMemberKey(key) {
  if (!key) return null;
  const [teamId, category, slotRaw] = key.split(":");
  return { teamId, category, slot: Number(slotRaw) };
}

function firstMemberOf(team) {
  for (const [category, roster] of orderedCategories(team.categories)) {
    const member = (roster ?? [])[0];
    if (member) return { category, member };
  }
  return null;
}

async function loadTeamIndex() {
  const res = await fetch("./data/teams/index.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load website/data/teams/index.json");
  return res.json();
}

async function loadSkillRarities() {
  try {
    const res = await fetch("./data/skills.json", { cache: "no-store" });
    if (!res.ok) return new Map();
    const data = await res.json();
    const map = new Map();
    for (const [name, rarity] of Object.entries(data.byName ?? {})) {
      map.set(normalizeSkillKey(name), String(rarity).toLowerCase());
    }
    return map;
  } catch {
    return new Map();
  }
}

function lookupSkillRarity(skillName) {
  const key = normalizeSkillKey(skillName);
  if (skillRarityByName.has(key)) return skillRarityByName.get(key);
  for (const [known, rarity] of skillRarityByName.entries()) {
    if (known.includes(key) || key.includes(known)) return rarity;
  }
  return "normal";
}

async function loadTeam(teamId) {
  if (teamCache.has(teamId)) return teamCache.get(teamId);
  const res = await fetch(`./data/teams/${encodeURIComponent(teamId)}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load team ${teamId}`);
  const team = await res.json();
  teamCache.set(teamId, team);
  return team;
}

function orderedCategories(categories) {
  const rows = CATEGORY_ORDER.filter((key) => categories?.[key]).map((key) => [key, categories[key]]);
  for (const [key, roster] of Object.entries(categories ?? {})) {
    if (!CATEGORY_ORDER.includes(key)) rows.push([key, roster]);
  }
  return rows;
}

function renderTrainerButton(team, category, member) {
  const key = memberKey(team.id, category, member.slot);
  const selected = selectedMemberKey === key ? "selected" : "";
  const umaName = member.uma?.name ?? "Unknown";
  const portrait = resolveAssetPath(member.uma?.spritePath);
  const initial = umaName.charAt(0).toUpperCase();
  return `
    <button type="button" class="trainer-pick ${selected}" data-member-key="${escapeHtml(key)}" data-team-id="${escapeHtml(team.id)}" data-category="${escapeHtml(category)}" data-slot="${member.slot}">
      <span class="trainer-pick-portrait">
        ${
          portrait
            ? `<img src="${portrait}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'trainer-pick-fallback',textContent:'${initial}'}))" />`
            : `<span class="trainer-pick-fallback">${initial}</span>`
        }
      </span>
      <span class="trainer-pick-copy">
        <span class="trainer-pick-name">${escapeHtml(member.trainer)}</span>
        <span class="trainer-pick-uma">${escapeHtml(umaName)}</span>
      </span>
      <span class="trainer-pick-cat">${escapeHtml(category)}</span>
    </button>
  `;
}

function renderTeamDetails(team) {
  const categories = orderedCategories(team.categories)
    .map(([category, roster]) => {
      const trainers = (roster ?? [])
        .map((member) => renderTrainerButton(team, category, member))
        .join("");
      return `
        <div class="team-category-block">
          <h4 class="team-category-title">${escapeHtml(category)}</h4>
          <div class="trainer-picks">${trainers}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="team-roster">
      ${team.tagline ? `<p class="team-tagline">${escapeHtml(team.tagline)}</p>` : ""}
      <p class="team-roster-hint">Click a trainer to view their uma</p>
      ${categories}
    </div>
  `;
}

function renderTeamsList() {
  const list = document.getElementById("teams-list");
  if (!list) return;

  if (!teamIndex.length) {
    list.innerHTML = `<p class="hint">No teams published yet. Run <code>npm run build:website</code> and push <code>website/</code>.</p>`;
    return;
  }

  list.innerHTML = teamIndex
    .map((team) => {
      const open = openTeamIds.has(team.id) ? "open" : "";
      return `
        <details class="team-collapse" data-team-id="${escapeHtml(team.id)}" style="--team:${escapeHtml(team.color)}" ${open}>
          <summary class="team-collapse-summary">
            <span class="team-collapse-swatch"></span>
            <span class="team-collapse-text">
              <strong>${escapeHtml(team.name)}</strong>
              <small>${escapeHtml(team.shortName)}</small>
            </span>
            <span class="team-collapse-chevron" aria-hidden="true"></span>
          </summary>
          <div class="team-collapse-body" data-team-body="${escapeHtml(team.id)}">
            <p class="hint team-loading">Loading roster…</p>
          </div>
        </details>
      `;
    })
    .join("");
}

function renderSkillChip(skill, index = 0) {
  const rarity = lookupSkillRarity(skill);
  const tone = index === 0 ? "unique-slot" : rarity === "rare" ? "rare" : rarity === "unique" ? "unique" : "normal";
  return `<span class="uma-skill-chip rarity-${tone}" title="${escapeHtml(skill)} (${escapeHtml(rarity)})">${escapeHtml(skill)}</span>`;
}

function renderUmaDetail(member, team) {
  const uma = member?.uma ?? {};
  const stats = uma.stats ?? {};
  const aptitudes = uma.aptitudes ?? {};
  const portrait = resolveAssetPath(uma.spritePath);
  const initial = (uma.name ?? "?").charAt(0).toUpperCase();
  const rating = String(uma.rating ?? "—");
  const styleKey = String(uma.style ?? "pace").toLowerCase();
  const styleLabel = STYLE_LABELS[styleKey] ?? uma.style ?? "—";

  const statCards = STAT_KEYS.map(
    ({ key, label, icon }) => `
      <article class="uma-stat-card">
        ${iconImg("stats", icon, "uma-stat-icon", label)}
        <div class="uma-stat-label">${label}</div>
        <div class="uma-stat-value">${Number(stats[key] ?? 0)}</div>
      </article>
    `
  ).join("");

  const aptCards = APTITUDE_ROWS.map(({ key, label }) => {
    const grade = String(aptitudes[key] ?? "—").toUpperCase();
    return `
      <article class="uma-apt-card">
        <div class="uma-apt-label">${label}</div>
        <div class="uma-apt-grade">${iconImg("grades", gradeIconName(grade), "uma-grade-icon", grade)}</div>
      </article>
    `;
  }).join("");

  const skills = Array.isArray(uma.skills) ? uma.skills.filter(Boolean) : [];
  const skillGrid = skills.length
    ? `<div class="uma-skill-grid">${skills.map((skill, index) => renderSkillChip(skill, index)).join("")}</div>`
    : `<p class="hint uma-empty">No skills listed.</p>`;

  return `
    <article class="uma-sheet">
      <header class="uma-sheet-head">
        <div class="uma-portrait-wrap">
          ${
            portrait
              ? `<img class="uma-portrait" src="${portrait}" alt="${escapeHtml(uma.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'uma-portrait fallback',textContent:'${initial}'}))" />`
              : `<div class="uma-portrait fallback">${initial}</div>`
          }
        </div>
        <div class="uma-sheet-titles">
          <div class="uma-sheet-rating">${iconImg("ratings", rating, "uma-rating-icon", rating)}</div>
          <h3 class="uma-sheet-name">${escapeHtml(uma.name ?? "Unknown")}</h3>
          <p class="uma-sheet-trainer">${escapeHtml(member.trainer)} · ${escapeHtml(team.name)}</p>
        </div>
      </header>

      <details class="uma-section" open>
        <summary>Stats</summary>
        <div class="uma-section-body">
          <div class="uma-stat-grid">${statCards}</div>
        </div>
      </details>

      <details class="uma-section" open>
        <summary>Aptitudes</summary>
        <div class="uma-section-body">
          <div class="uma-apt-grid">${aptCards}</div>
          <div class="uma-style-row">
            <span class="uma-style-label">Run Style</span>
            <span class="uma-style-pill">
              <img class="uma-style-icon" src="./assets/runstyle/${escapeHtml(styleKey)}.png" alt="" onerror="this.style.display='none'" />
              <span>${escapeHtml(styleLabel)}</span>
            </span>
          </div>
        </div>
      </details>

      <details class="uma-section" open>
        <summary>Skills <span class="uma-skill-count">${skills.length}</span></summary>
        <div class="uma-section-body">${skillGrid}</div>
      </details>
    </article>
  `;
}

function renderUmaPanel() {
  const panel = document.getElementById("uma-detail");
  if (!panel) return;

  if (!selectedMemberKey) {
    panel.innerHTML = `
      <div class="uma-detail-empty">
        <p class="hint">Open a team, then click a trainer to view their uma sheet.</p>
      </div>
    `;
    return;
  }

  const parsed = parseMemberKey(selectedMemberKey);
  const team = teamCache.get(parsed?.teamId);
  const member = team?.categories?.[parsed.category]?.[parsed.slot];
  if (!team || !member) {
    panel.innerHTML = `<p class="hint uma-detail-empty">Could not load this uma.</p>`;
    return;
  }

  panel.innerHTML = renderUmaDetail(member, team);
}

function syncTrainerSelection() {
  document.querySelectorAll(".trainer-pick").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.memberKey === selectedMemberKey);
  });
}

async function ensureTeamLoaded(teamId) {
  const team = await loadTeam(teamId);
  const body = document.querySelector(`[data-team-body="${CSS.escape(teamId)}"]`);
  if (body) body.innerHTML = renderTeamDetails(team);
  syncTrainerSelection();
  return team;
}

async function selectMember(teamId, category, slot) {
  await ensureTeamLoaded(teamId);
  selectedMemberKey = memberKey(teamId, category, slot);
  syncTrainerSelection();
  renderUmaPanel();
}

async function openTeamAndShowUma(teamId) {
  openTeamIds.add(teamId);
  const team = await ensureTeamLoaded(teamId);
  const first = firstMemberOf(team);
  if (!first) {
    selectedMemberKey = null;
    renderUmaPanel();
    return;
  }

  const alreadyOnThisTeam = selectedMemberKey?.startsWith(`${teamId}:`);
  if (!alreadyOnThisTeam) {
    selectedMemberKey = memberKey(teamId, first.category, first.member.slot);
  }
  syncTrainerSelection();
  renderUmaPanel();
}

async function hydrateOpenTeams() {
  const ids = [...openTeamIds];
  for (const teamId of ids) {
    try {
      await ensureTeamLoaded(teamId);
    } catch (err) {
      console.warn(err);
    }
  }
  if (selectedMemberKey) renderUmaPanel();
}

export async function refreshTeamsPage({ force = false } = {}) {
  try {
    const [nextIndex, rarities] = await Promise.all([loadTeamIndex(), loadSkillRarities()]);
    skillRarityByName = rarities;
    const indexChanged =
      force ||
      !teamsBooted ||
      JSON.stringify(nextIndex) !== JSON.stringify(teamIndex);

    teamIndex = nextIndex;

    if (indexChanged) {
      renderTeamsList();
      await hydrateOpenTeams();
      teamsBooted = true;
    }

    renderUmaPanel();
  } catch (err) {
    const list = document.getElementById("teams-list");
    if (list) {
      list.innerHTML = `<p class="hint">Teams data unavailable. Run <code>npm run build:website</code>.</p>`;
    }
    console.warn(err);
  }
}

export function setupTeamsPage() {
  const list = document.getElementById("teams-list");
  if (!list) return;

  // `toggle` does not bubble in older browsers — listen in capture phase.
  list.addEventListener(
    "toggle",
    async (event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement)) return;
      if (!details.classList.contains("team-collapse")) return;
      const teamId = details.dataset.teamId;
      if (!teamId) return;

      if (!details.open) {
        openTeamIds.delete(teamId);
        return;
      }

      try {
        await openTeamAndShowUma(teamId);
      } catch (err) {
        const body = details.querySelector("[data-team-body]");
        if (body) body.innerHTML = `<p class="hint">Failed to load team.</p>`;
        console.warn(err);
      }
    },
    true
  );

  list.addEventListener("click", async (event) => {
    const btn = event.target.closest(".trainer-pick");
    if (btn) {
      event.preventDefault();
      await selectMember(btn.dataset.teamId, btn.dataset.category, Number(btn.dataset.slot));
      return;
    }

    // Fallback when toggle capture isn't available: load after summary click.
    const summary = event.target.closest(".team-collapse-summary");
    if (!summary) return;
    const details = summary.closest("details.team-collapse");
    if (!details) return;
    const teamId = details.dataset.teamId;
    if (!teamId) return;
    setTimeout(async () => {
      if (!details.open) {
        openTeamIds.delete(teamId);
        return;
      }
      try {
        await openTeamAndShowUma(teamId);
      } catch (err) {
        console.warn(err);
      }
    }, 0);
  });
}
