const CATEGORIES = [
  { key: "sprint", label: "Sprint" },
  { key: "mile", label: "Mile" },
  { key: "medium", label: "Medium" },
  { key: "long", label: "Long" },
  { key: "dirt", label: "Dirt" },
];

const STYLES = ["runaway", "front", "pace", "late", "end"];
const APTITUDE_GRADES = ["S", "A", "B", "C", "D", "E", "F", "G"];
const APTITUDE_KEYS = ["terrain", "distance", "style"];
const $ = (id) => document.getElementById(id);

let teams = [];
let characters = [];
let charactersById = new Map();
let skills = [];
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

function emptyAptitudes() {
  return { terrain: "A", distance: "A", style: "A" };
}

function emptyMember(trainer) {
  return {
    trainer,
    locked: false,
    uma: {
      name: "Uma Name",
      spriteId: "",
      rating: "S",
      style: "front",
      aptitudes: emptyAptitudes(),
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

function readSlotIntoDraft(slot, { ignoreLock = false } = {}) {
  if (!draft) return;
  const roster = draft.categories[activeCategory];
  const root = document.querySelector(`[data-slot="${slot}"]`);
  if (!root || !roster?.[slot]) return;
  const member = roster[slot];
  member.locked = Boolean(root.querySelector('[name="locked"]')?.checked);
  if (member.locked && !ignoreLock) return;

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
  if (!member.uma.aptitudes) member.uma.aptitudes = emptyAptitudes();
  for (const key of APTITUDE_KEYS) {
    const value = root.querySelector(`[name="apt-${key}"]`)?.value;
    member.uma.aptitudes[key] = APTITUDE_GRADES.includes(value) ? value : "A";
  }
  member.uma.stats.speed = Number(root.querySelector('[name="speed"]').value) || 0;
  member.uma.stats.stamina = Number(root.querySelector('[name="stamina"]').value) || 0;
  member.uma.stats.power = Number(root.querySelector('[name="power"]').value) || 0;
  member.uma.stats.guts = Number(root.querySelector('[name="guts"]').value) || 0;
  member.uma.stats.wisdom = Number(root.querySelector('[name="wisdom"]').value) || 0;
  member.uma.skills = [...root.querySelectorAll(".skill-chip")]
    .map((chip) => chip.dataset.skill?.trim())
    .filter(Boolean);
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

  for (let slot = 0; slot < 3; slot += 1) {
    readSlotIntoDraft(slot);
  }
}

function applyMemberLockState(card, locked) {
  card.classList.toggle("is-locked", locked);
  card.classList.toggle("is-unlocked", !locked);
  const lockText = card.querySelector(".member-lock-text");
  if (lockText) lockText.textContent = locked ? "Locked" : "Unlocked";

  for (const el of card.querySelectorAll("input, select, button")) {
    if (el.name === "locked") continue;
    el.disabled = locked;
  }

  const picker = card.querySelector(".skills-picker");
  if (!picker) return;
  picker.classList.toggle("is-locked", locked);
  const chips = picker.querySelector(".skills-chips");
  if (chips) {
    chips.innerHTML = buildSkillChips(selectedSkillsFromPicker(picker), locked);
  }
  if (locked) closeSkillSuggestions(picker);
}

function renderCategoryTabs() {
  $("team-cat-tabs").innerHTML = CATEGORIES.map((cat) => {
    const roster = draft?.categories?.[cat.key] ?? [];
    const openCount = roster.filter((member) => !member.locked).length;
    const badge =
      openCount > 0
        ? `<span class="team-cat-open" title="${openCount} unlocked">${openCount}</span>`
        : `<span class="team-cat-locked" title="All locked">✓</span>`;
    return `<button type="button" class="team-cat-tab ${cat.key === activeCategory ? "active" : ""}" data-category="${cat.key}">${cat.label}${badge}</button>`;
  }).join("");
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

function buildSkillsPicker(skillList, locked = false) {
  return `
    <div class="skills-picker span-2 ${locked ? "is-locked" : ""}">
      <span class="skills-picker-label">Skills</span>
      <div class="skills-chips">${buildSkillChips(skillList, locked)}</div>
      <div class="skills-search-wrap">
        <input
          class="skills-search"
          type="text"
          placeholder="Type to add a skill…"
          autocomplete="off"
          spellcheck="false"
          ${locked ? "disabled" : ""}
        />
        <ul class="skills-suggestions" hidden></ul>
      </div>
    </div>
  `;
}

function buildSkillChips(skillList, locked = false) {
  return (skillList ?? [])
    .map(
      (skill) =>
        `<button type="button" class="skill-chip" data-skill="${escapeAttr(skill)}" title="${locked ? "" : "Remove"}" ${locked ? "disabled" : ""}>
          <span>${escapeAttr(skill)}</span>
          ${locked ? "" : `<span class="skill-chip-x" aria-hidden="true">×</span>`}
        </button>`
    )
    .join("");
}

function normalizeSkillQuery(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function filterSkillSuggestions(query, selectedSkills) {
  const selected = new Set((selectedSkills ?? []).map((s) => s.toLowerCase()));
  const q = String(query ?? "").trim().toLowerCase();
  const qNorm = normalizeSkillQuery(query);
  if (!q) return [];

  const scored = [];
  for (const skill of skills) {
    if (selected.has(skill.name.toLowerCase())) continue;
    const nameLower = skill.name.toLowerCase();
    const nameNorm = normalizeSkillQuery(skill.name);
    const aliasHit = (skill.aliases ?? []).some((alias) => {
      const a = String(alias).toLowerCase();
      return a.includes(q) || normalizeSkillQuery(alias).includes(qNorm);
    });

    let score = -1;
    if (nameLower === q) score = 0;
    else if (nameLower.startsWith(q)) score = 1;
    else if (nameNorm.startsWith(qNorm) && qNorm) score = 2;
    else if (nameLower.includes(q)) score = 3;
    else if (nameNorm.includes(qNorm) && qNorm) score = 4;
    else if (aliasHit) score = 5;

    if (score >= 0) scored.push({ skill, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, 12)
    .map((row) => row.skill);
}

function selectedSkillsFromPicker(picker) {
  return [...picker.querySelectorAll(".skill-chip")]
    .map((chip) => chip.dataset.skill?.trim())
    .filter(Boolean);
}

function renderSkillSuggestions(picker, query) {
  const list = picker.querySelector(".skills-suggestions");
  if (!list) return;
  const matches = filterSkillSuggestions(query, selectedSkillsFromPicker(picker));
  if (!matches.length) {
    list.hidden = true;
    list.innerHTML = "";
    return;
  }
  list.hidden = false;
  list.innerHTML = matches
    .map(
      (skill, index) =>
        `<li>
          <button type="button" class="skills-suggestion" data-skill="${escapeAttr(skill.name)}" data-index="${index}">
            <span class="skills-suggestion-name">${escapeAttr(skill.name)}</span>
            <span class="skills-suggestion-meta">${escapeAttr(skill.rarity)}${skill.category ? ` · ${escapeAttr(skill.category)}` : ""}</span>
          </button>
        </li>`
    )
    .join("");
}

function addSkillToPicker(picker, skillName) {
  const name = String(skillName ?? "").trim();
  if (!name) return false;
  const chips = picker.querySelector(".skills-chips");
  if (!chips) return false;
  const existing = selectedSkillsFromPicker(picker).map((s) => s.toLowerCase());
  if (existing.includes(name.toLowerCase())) return false;
  chips.insertAdjacentHTML("beforeend", buildSkillChips([name]));
  setDirty(true);
  return true;
}

function closeSkillSuggestions(picker) {
  const list = picker.querySelector(".skills-suggestions");
  if (!list) return;
  list.hidden = true;
  list.innerHTML = "";
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
      const aptitudes = {
        ...emptyAptitudes(),
        ...(member.uma.aptitudes && typeof member.uma.aptitudes === "object" ? member.uma.aptitudes : {}),
      };
      const locked = Boolean(member.locked);
      const aptitudeRow = APTITUDE_KEYS.map((key) => {
        const current = APTITUDE_GRADES.includes(aptitudes[key]) ? aptitudes[key] : "A";
        const options = APTITUDE_GRADES.map(
          (grade) => `<option value="${grade}" ${grade === current ? "selected" : ""}>${grade}</option>`
        ).join("");
        return `<label>
              ${key}
              <select name="apt-${key}" ${locked ? "disabled" : ""}>${options}</select>
            </label>`;
      }).join("");
      return `
        <article class="member-card ${locked ? "is-locked" : "is-unlocked"}" data-slot="${slot}">
          <header class="member-card-head">
            <span class="member-slot-label">Slot ${slot + 1}</span>
            <label class="member-lock">
              <input name="locked" type="checkbox" ${locked ? "checked" : ""} />
              <span class="member-lock-text">${locked ? "Locked" : "Unlocked"}</span>
            </label>
          </header>
          <div class="member-grid">
            <label>
              Trainer
              <input name="trainer" type="text" value="${escapeAttr(member.trainer)}" ${locked ? "disabled" : ""} />
            </label>
            <label class="uma-select-label">
              Uma
              <div class="uma-select-row">
                <select name="umaSelect" ${locked ? "disabled" : ""}>${buildUmaOptions(selectedSpriteId)}</select>
                ${
                  picked?.spritePath
                    ? `<img class="uma-preview" src="${escapeAttr(picked.spritePath)}" alt="" />`
                    : `<div class="uma-preview empty"></div>`
                }
              </div>
            </label>
            <label>
              Rating
              <input name="rating" type="text" value="${escapeAttr(member.uma.rating ?? "S")}" ${locked ? "disabled" : ""} />
            </label>
            <label>
              Style
              <select name="style" ${locked ? "disabled" : ""}>${styleOptions}</select>
            </label>
            ${buildSkillsPicker(member.uma.skills ?? [], locked)}
          </div>
          <div class="aptitudes-grid">
            ${aptitudeRow}
          </div>
          <div class="stats-grid">
            ${["speed", "stamina", "power", "guts", "wisdom"]
              .map(
                (stat) => `<label>
              ${stat}
              <input name="${stat}" type="number" min="0" max="2000" value="${member.uma.stats?.[stat] ?? 0}" ${locked ? "disabled" : ""} />
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

$("roster-editor").addEventListener("input", (event) => {
  setDirty(true);
  const search = event.target.closest(".skills-search");
  if (!search) return;
  const picker = search.closest(".skills-picker");
  if (!picker) return;
  renderSkillSuggestions(picker, search.value);
});

$("roster-editor").addEventListener("focusin", (event) => {
  const search = event.target.closest(".skills-search");
  if (!search) return;
  const picker = search.closest(".skills-picker");
  if (!picker) return;
  if (search.value.trim()) renderSkillSuggestions(picker, search.value);
});

$("roster-editor").addEventListener("keydown", (event) => {
  const search = event.target.closest(".skills-search");
  if (!search) return;
  const picker = search.closest(".skills-picker");
  if (!picker) return;
  const list = picker.querySelector(".skills-suggestions");

  if (event.key === "Escape") {
    closeSkillSuggestions(picker);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const active = list?.querySelector(".skills-suggestion.active");
    const first = active ?? list?.querySelector(".skills-suggestion");
    if (first) {
      addSkillToPicker(picker, first.dataset.skill);
      search.value = "";
      renderSkillSuggestions(picker, "");
      search.focus();
    }
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const items = [...(list?.querySelectorAll(".skills-suggestion") ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const active = list.querySelector(".skills-suggestion.active");
    let index = items.indexOf(active);
    if (event.key === "ArrowDown") index = index < 0 ? 0 : Math.min(items.length - 1, index + 1);
    else index = index <= 0 ? items.length - 1 : index - 1;
    items.forEach((item) => item.classList.remove("active"));
    items[index].classList.add("active");
    items[index].scrollIntoView({ block: "nearest" });
  }
});

$("roster-editor").addEventListener("mousedown", (event) => {
  const suggestion = event.target.closest(".skills-suggestion");
  if (suggestion) {
    // Keep input focus so the picker stays open for the next skill.
    event.preventDefault();
  }
});

$("roster-editor").addEventListener("click", (event) => {
  const card = event.target.closest(".member-card");
  if (card?.classList.contains("is-locked") && !event.target.closest(".member-lock")) {
    return;
  }

  const chip = event.target.closest(".skill-chip");
  if (chip) {
    if (chip.disabled) return;
    chip.remove();
    setDirty(true);
    return;
  }

  const suggestion = event.target.closest(".skills-suggestion");
  if (!suggestion) return;
  const picker = suggestion.closest(".skills-picker");
  if (picker?.classList.contains("is-locked")) return;
  const search = picker?.querySelector(".skills-search");
  addSkillToPicker(picker, suggestion.dataset.skill);
  if (search) {
    search.value = "";
    search.focus();
    renderSkillSuggestions(picker, "");
  }
});

$("roster-editor").addEventListener("focusout", (event) => {
  const picker = event.target.closest(".skills-picker");
  if (!picker) return;
  // Delay so suggestion clicks can run first.
  setTimeout(() => {
    if (picker.contains(document.activeElement)) return;
    closeSkillSuggestions(picker);
  }, 0);
});

$("roster-editor").addEventListener("change", (event) => {
  const lock = event.target.closest('input[name="locked"]');
  if (lock) {
    const card = lock.closest(".member-card");
    if (!card || !draft) return;
    const slot = Number(card.dataset.slot);
    const member = draft.categories[activeCategory]?.[slot];
    if (!member) return;

    if (lock.checked) {
      // Capture current values even though inputs are about to disable.
      readSlotIntoDraft(slot, { ignoreLock: true });
      member.locked = true;
    } else {
      member.locked = false;
    }

    applyMemberLockState(card, member.locked);
    renderCategoryTabs();
    setDirty(true);
    return;
  }

  setDirty(true);
  const select = event.target.closest('select[name="umaSelect"]');
  if (!select) return;
  const card = select.closest(".member-card");
  if (!card || card.classList.contains("is-locked")) return;
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
  const [teamData, characterData, skillData] = await Promise.all([
    api("/api/teams"),
    api("/api/characters"),
    api("/api/skills"),
  ]);
  teams = teamData.teams ?? [];
  characters = characterData.characters ?? [];
  charactersById = new Map(characters.map((row) => [String(row.spriteId), row]));
  skills = skillData.skills ?? [];
  renderTeamList();
}

boot().catch((err) => setStatus(err.message, true));
