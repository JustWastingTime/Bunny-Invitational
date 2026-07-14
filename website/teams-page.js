const CATEGORY_ORDER = ["sprint", "mile", "medium", "long", "dirt"];

const STAT_KEYS = [
  { key: "speed", label: "SPD", icon: "speed" },
  { key: "stamina", label: "STA", icon: "stamina" },
  { key: "power", label: "POW", icon: "power" },
  { key: "guts", label: "GUT", icon: "guts" },
  { key: "wisdom", label: "WIT", icon: "wisdom" },
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

let teamIndex = [];
const teamCache = new Map();
let selectedMemberKey = null;

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

async function loadTeamIndex() {
  const res = await fetch("./data/teams/index.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load website/data/teams/index.json");
  return res.json();
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
  return `
    <button type="button" class="trainer-pick ${selected}" data-member-key="${escapeHtml(key)}" data-team-id="${escapeHtml(team.id)}" data-category="${escapeHtml(category)}" data-slot="${member.slot}">
      <span class="trainer-pick-name">${escapeHtml(member.trainer)}</span>
      <span class="trainer-pick-uma">${escapeHtml(umaName)}</span>
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
      const open = teamCache.has(team.id) ? "open" : "";
      return `
        <details class="team-collapse" data-team-id="${escapeHtml(team.id)}" style="--team:${escapeHtml(team.color)}" ${open}>
          <summary class="team-collapse-summary">
            <span class="team-collapse-swatch"></span>
            <span class="team-collapse-text">
              <strong>${escapeHtml(team.name)}</strong>
              <small>${escapeHtml(team.shortName)}</small>
            </span>
          </summary>
          <div class="team-collapse-body" data-team-body="${escapeHtml(team.id)}">
            <p class="hint team-loading">Loading roster…</p>
          </div>
        </details>
      `;
    })
    .join("");
}

function renderSkillChip(skill) {
  return `<span class="uma-skill-chip" title="${escapeHtml(skill)}">${escapeHtml(skill)}</span>`;
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
        <div class="uma-apt-grade">${iconImg("grades", grade, "uma-grade-icon", grade)}</div>
      </article>
    `;
  }).join("");

  const skills = Array.isArray(uma.skills) ? uma.skills.filter(Boolean) : [];
  const skillGrid = skills.length
    ? `<div class="uma-skill-grid">${skills.map(renderSkillChip).join("")}</div>`
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
    panel.innerHTML = `<p class="hint uma-detail-empty">Select a trainer to view their uma.</p>`;
    return;
  }

  const [teamId, category, slotRaw] = selectedMemberKey.split(":");
  const slot = Number(slotRaw);
  const team = teamCache.get(teamId);
  const member = team?.categories?.[category]?.[slot];
  if (!team || !member) {
    panel.innerHTML = `<p class="hint uma-detail-empty">Could not load this uma.</p>`;
    return;
  }

  panel.innerHTML = renderUmaDetail(member, team);
}

async function ensureTeamLoaded(teamId) {
  const team = await loadTeam(teamId);
  const body = document.querySelector(`[data-team-body="${teamId}"]`);
  if (body) body.innerHTML = renderTeamDetails(team);
  return team;
}

async function selectMember(teamId, category, slot) {
  await ensureTeamLoaded(teamId);
  selectedMemberKey = memberKey(teamId, category, slot);
  document.querySelectorAll(".trainer-pick").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.memberKey === selectedMemberKey);
  });
  renderUmaPanel();
}

export async function refreshTeamsPage() {
  try {
    teamIndex = await loadTeamIndex();
    renderTeamsList();
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

  list.addEventListener("toggle", async (event) => {
    const details = event.target.closest("details.team-collapse");
    if (!details || !details.open) return;
    const teamId = details.dataset.teamId;
    if (!teamId || teamCache.has(teamId)) return;
    try {
      await ensureTeamLoaded(teamId);
    } catch (err) {
      const body = details.querySelector("[data-team-body]");
      if (body) body.innerHTML = `<p class="hint">Failed to load team.</p>`;
      console.warn(err);
    }
  });

  list.addEventListener("click", async (event) => {
    const btn = event.target.closest(".trainer-pick");
    if (!btn) return;
    await selectMember(btn.dataset.teamId, btn.dataset.category, Number(btn.dataset.slot));
  });
}
