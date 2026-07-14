const CATEGORIES = [
  { key: "sprint", label: "Sprint" },
  { key: "mile", label: "Mile" },
  { key: "medium", label: "Medium" },
  { key: "long", label: "Long" },
  { key: "dirt", label: "Dirt" },
];

const STYLES = ["runaway", "front", "pace", "late", "end"];
const $ = (id) => document.getElementById(id);

let teams = [];
let characters = [];
let charactersById = new Map();
let draft = null;
let selectedId = null;
let isNew = false;
let activeCategory = "sprint";
let statusTimer = null;
let dirty = false;

async function api(path, options = {}) {
  const res = await fetch(path, { cache: "no-store", ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function setStatus(message, isError = false) {
  const el = $("team-editor-status");
  el.textContent = message;
  el.classList.toggle("error", isError);
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    if (el.textContent === message) el.textContent = "";
  }, 5000);
}

function setDirty(next = true) {
  dirty = next;
  const saveBtn = $("team-save");
  if (!saveBtn) return;
  saveBtn.classList.toggle("needs-save", dirty);
  saveBtn.textContent = dirty ? "Save to JSON *" : "Save to JSON";
}

function emptyMember(trainer) {
  return {
    trainer,
    uma: {
      name: "Uma Name",
      spriteId: "",
      rating: "S",
      style: "front",
      stats: { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 },
      skills: [],
    },
  };
}

function emptyTeam() {
  const name = "New Team";
  const categories = {};
  for (const cat of CATEGORIES) {
    categories[cat.key] = [0, 1, 2].map((i) => emptyMember(`${name} ${cat.key} ${i + 1}`));
  }
  return {
    id: "new-team",
    name,
    shortName: "NEW",
    tagline: "",
    color: "#e91e8c",
    categories,
  };
}

function renderTeamList() {
  $("team-list").innerHTML = teams
    .map(
      (team) => `<button type="button" class="team-list-item ${team.id === selectedId ? "active" : ""}" data-team-id="${team.id}">
        <span class="team-list-swatch" style="background:${team.color}"></span>
        <span class="team-list-text">
          <strong>${team.name}</strong>
          <small>${team.id}</small>
        </span>
      </button>`
    )
    .join("") || `<p class="hint">No teams yet.</p>`;
}

function readFormIntoDraft() {
  if (!draft) return;
  const previousId = draft.id;
  draft.name = $("team-name").value.trim();
  draft.shortName = $("team-short").value.trim() || draft.name;
  draft.tagline = $("team-tagline").value.trim();
  draft.color = $("team-color").value;
  if (isNew) {
    draft.id = slugify($("team-id").value || draft.name) || previousId;
    $("team-id").value = draft.id;
  }

  const roster = draft.categories[activeCategory];
  for (let slot = 0; slot < 3; slot += 1) {
    const root = document.querySelector(`[data-slot="${slot}"]`);
    if (!root) continue;
    const member = roster[slot];
    member.trainer = root.querySelector('[name="trainer"]').value.trim();
    const selected = root.querySelector('[name="umaSelect"]');
    const spriteId = selected?.value?.trim() || "";
    const picked = charactersById.get(spriteId);
    if (picked) {
      member.uma.name = picked.name;
      member.uma.spriteId = picked.spriteId;
      delete member.uma.characterId;
    } else {
      member.uma.name = root.querySelector('[name="umaName"]')?.value.trim() || member.uma.name;
      member.uma.spriteId = spriteId || member.uma.spriteId || "";
    }
    member.uma.rating = root.querySelector('[name="rating"]').value.trim() || "S";
    member.uma.style = root.querySelector('[name="style"]').value;
    member.uma.stats.speed = Number(root.querySelector('[name="speed"]').value) || 0;
    member.uma.stats.stamina = Number(root.querySelector('[name="stamina"]').value) || 0;
    member.uma.stats.power = Number(root.querySelector('[name="power"]').value) || 0;
    member.uma.stats.guts = Number(root.querySelector('[name="guts"]').value) || 0;
    member.uma.stats.wisdom = Number(root.querySelector('[name="wisdom"]').value) || 0;
    member.uma.skills = root
      .querySelector('[name="skills"]')
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function renderCategoryTabs() {
  $("team-cat-tabs").innerHTML = CATEGORIES.map(
    (cat) =>
      `<button type="button" class="team-cat-tab ${cat.key === activeCategory ? "active" : ""}" data-category="${cat.key}">${cat.label}</button>`
  ).join("");
}

function matchUmaOption(uma) {
  const spriteId = String(uma?.spriteId ?? "").trim();
  if (spriteId && charactersById.has(spriteId)) return spriteId;

  const name = String(uma?.name ?? "").trim().toLowerCase();
  const characterId = String(uma?.characterId ?? "").trim().toLowerCase();
  if (!name && !characterId) return "";

  const candidates = characters.filter((row) => {
    const rowName = row.name.toLowerCase();
    const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return rowName === name || slug === characterId || rowName.replace(/\s+/g, "") === characterId.replace(/-/g, "");
  });
  if (!candidates.length) return spriteId;
  const original = candidates.find((row) => row.variant.toLowerCase() === "original");
  return (original ?? candidates[0]).spriteId;
}

function buildUmaOptions(selectedSpriteId) {
  const groups = new Map();
  for (const row of characters) {
    if (!groups.has(row.name)) groups.set(row.name, []);
    groups.get(row.name).push(row);
  }

  const parts = [`<option value="">— Select uma —</option>`];
  for (const [name, rows] of groups.entries()) {
    parts.push(`<optgroup label="${escapeAttr(name)}">`);
    for (const row of rows) {
      const selected = String(row.spriteId) === String(selectedSpriteId) ? "selected" : "";
      parts.push(
        `<option value="${escapeAttr(row.spriteId)}" ${selected} data-name="${escapeAttr(row.name)}" data-variant="${escapeAttr(row.variant)}" data-sprite="${escapeAttr(row.spritePath ?? "")}">${escapeAttr(row.label)}</option>`
      );
    }
    parts.push(`</optgroup>`);
  }
  return parts.join("");
}

function renderRoster() {
  if (!draft) return;
  const roster = draft.categories[activeCategory] ?? [];
  $("roster-editor").innerHTML = [0, 1, 2]
    .map((slot) => {
      const member = roster[slot] ?? emptyMember(`Slot ${slot + 1}`);
      const selectedSpriteId = matchUmaOption(member.uma);
      const picked = charactersById.get(String(selectedSpriteId));
      const styleOptions = STYLES.map(
        (style) =>
          `<option value="${style}" ${member.uma.style === style ? "selected" : ""}>${style}</option>`
      ).join("");
      return `
        <article class="member-card" data-slot="${slot}">
          <header class="member-card-head">Slot ${slot + 1}</header>
          <div class="member-grid">
            <label>
              Trainer
              <input name="trainer" type="text" value="${escapeAttr(member.trainer)}" />
            </label>
            <label class="uma-select-label">
              Uma
              <div class="uma-select-row">
                <select name="umaSelect">${buildUmaOptions(selectedSpriteId)}</select>
                ${
                  picked?.spritePath
                    ? `<img class="uma-preview" src="${escapeAttr(picked.spritePath)}" alt="" />`
                    : `<div class="uma-preview empty"></div>`
                }
              </div>
            </label>
            <label>
              Rating
              <input name="rating" type="text" value="${escapeAttr(member.uma.rating ?? "S")}" />
            </label>
            <label>
              Style
              <select name="style">${styleOptions}</select>
            </label>
            <label class="span-2">
              Skills (comma-separated)
              <input name="skills" type="text" value="${escapeAttr((member.uma.skills ?? []).join(", "))}" />
            </label>
          </div>
          <div class="stats-grid">
            ${["speed", "stamina", "power", "guts", "wisdom"]
              .map(
                (stat) => `<label>
              ${stat}
              <input name="${stat}" type="number" min="0" max="2000" value="${member.uma.stats?.[stat] ?? 0}" />
            </label>`
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function showForm(team, { asNew = false } = {}) {
  draft = structuredClone(team);
  isNew = asNew;
  selectedId = asNew ? null : team.id;
  activeCategory = "sprint";

  $("team-form-empty").classList.add("hidden");
  $("team-form").classList.remove("hidden");
  $("team-id").value = draft.id;
  $("team-id").readOnly = !asNew;
  $("team-name").value = draft.name;
  $("team-short").value = draft.shortName ?? "";
  $("team-tagline").value = draft.tagline ?? "";
  $("team-color").value = draft.color || "#e91e8c";
  $("team-delete").classList.toggle("hidden", asNew);

  renderTeamList();
  renderCategoryTabs();
  renderRoster();
  setDirty(false);
}

async function refreshTeamList() {
  const data = await api("/api/teams");
  teams = data.teams ?? [];
  renderTeamList();
}

async function openTeam(teamId) {
  const data = await api(`/api/teams/${encodeURIComponent(teamId)}`);
  showForm(data.team, { asNew: false });
}

async function createNewTeam() {
  const data = await api("/api/teams/new");
  showForm(data.team ?? emptyTeam(), { asNew: true });
  $("team-id").focus();
}

async function saveCurrentTeam(event) {
  event?.preventDefault?.();
  if (!draft) return;
  readFormIntoDraft();

  try {
    if (isNew) {
      if (!draft.id) throw new Error("Team id is required");
      const result = await api("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setDirty(false);
      setStatus(`Created data/teams/${result.team.id}.json`);
      await refreshTeamList();
      await openTeam(result.team.id);
    } else {
      const result = await api(`/api/teams/${encodeURIComponent(selectedId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setDirty(false);
      setStatus(`Saved data/teams/${result.team.id}.json`);
      await refreshTeamList();
      showForm(result.team, { asNew: false });
    }
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function deleteCurrentTeam() {
  if (!selectedId || isNew) return;
  if (!confirm(`Delete team "${selectedId}"? This cannot be undone.`)) return;
  try {
    await api(`/api/teams/${encodeURIComponent(selectedId)}`, { method: "DELETE" });
    setStatus(`Deleted ${selectedId}`);
    draft = null;
    selectedId = null;
    $("team-form").classList.add("hidden");
    $("team-form-empty").classList.remove("hidden");
    await refreshTeamList();
  } catch (err) {
    setStatus(err.message, true);
  }
}

$("team-list").addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-team-id]");
  if (!btn) return;
  if (draft && dirty) {
    const leave = confirm("You have unsaved changes. Discard them and switch teams?");
    if (!leave) return;
  }
  try {
    await openTeam(btn.dataset.teamId);
  } catch (err) {
    setStatus(err.message, true);
  }
});

$("team-cat-tabs").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-category]");
  if (!btn || !draft) return;
  readFormIntoDraft();
  activeCategory = btn.dataset.category;
  renderCategoryTabs();
  renderRoster();
});

$("team-name").addEventListener("input", () => {
  setDirty(true);
  if (!isNew) return;
  if (!$("team-id").dataset.touched) {
    $("team-id").value = slugify($("team-name").value) || "new-team";
  }
});

$("team-id").addEventListener("input", () => {
  $("team-id").dataset.touched = "1";
  setDirty(true);
});

for (const id of ["team-short", "team-tagline", "team-color"]) {
  $(id).addEventListener("input", () => setDirty(true));
  $(id).addEventListener("change", () => setDirty(true));
}

$("team-new").addEventListener("click", () => {
  if (draft && dirty) {
    const leave = confirm("You have unsaved changes. Discard them and create a new team?");
    if (!leave) return;
  }
  createNewTeam().catch((err) => setStatus(err.message, true));
});

$("roster-editor").addEventListener("input", () => setDirty(true));
$("roster-editor").addEventListener("change", (event) => {
  setDirty(true);
  const select = event.target.closest('select[name="umaSelect"]');
  if (!select) return;
  const card = select.closest(".member-card");
  if (!card) return;
  const picked = charactersById.get(select.value);
  const preview = card.querySelector(".uma-preview");
  if (!preview) return;
  if (picked?.spritePath) {
    preview.outerHTML = `<img class="uma-preview" src="${escapeAttr(picked.spritePath)}" alt="" />`;
  } else {
    preview.outerHTML = `<div class="uma-preview empty"></div>`;
  }
});

$("team-form").addEventListener("submit", saveCurrentTeam);
$("team-delete").addEventListener("click", deleteCurrentTeam);

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    if (!$("team-form") || $("team-form").classList.contains("hidden")) return;
    event.preventDefault();
    saveCurrentTeam(event);
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

async function boot() {
  const [teamData, characterData] = await Promise.all([api("/api/teams"), api("/api/characters")]);
  teams = teamData.teams ?? [];
  characters = characterData.characters ?? [];
  charactersById = new Map(characters.map((row) => [String(row.spriteId), row]));
  renderTeamList();
}

boot().catch((err) => setStatus(err.message, true));
