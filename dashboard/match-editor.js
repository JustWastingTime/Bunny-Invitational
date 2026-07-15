const $ = (id) => document.getElementById(id);

let matches = [];
let teams = [];
let draft = null;
let selectedId = null;
let dirty = false;
let statusTimer = null;

async function api(path, options = {}) {
  const res = await fetch(path, { cache: "no-store", ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function setStatus(message, isError = false) {
  const el = $("match-editor-status");
  el.textContent = message;
  el.classList.toggle("error", isError);
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    if (el.textContent === message) el.textContent = "";
  }, 5000);
}

function setDirty(next = true) {
  dirty = next;
  const saveBtn = $("match-save");
  if (!saveBtn) return;
  saveBtn.classList.toggle("needs-save", dirty);
  saveBtn.textContent = dirty ? "Save to JSON *" : "Save to JSON";
}

function teamOptionHtml(selectedId) {
  const opts = [`<option value="">— TBD —</option>`];
  for (const team of teams) {
    const sel = team.id === selectedId ? " selected" : "";
    opts.push(`<option value="${team.id}"${sel}>${team.name}</option>`);
  }
  return opts.join("");
}

function renderList() {
  $("match-list").innerHTML = matches
    .map((match) => {
      const names = (match.teamNames ?? []).filter((n) => n && n !== "TBD");
      const summary = names.length ? names.join(" · ") : "No teams set";
      return `<button type="button" class="team-list-item ${match.id === selectedId ? "active" : ""}" data-match-id="${match.id}">
        <span class="team-list-swatch" style="background:${match.filled === 3 ? "#6bcb77" : match.filled ? "#ffcf8a" : "#666"}"></span>
        <span class="team-list-text">
          <strong>${match.label || match.round || match.id}</strong>
          <small>${match.id} · ${summary}</small>
        </span>
      </button>`;
    })
    .join("");
}

function fillForm(match) {
  draft = {
    id: match.id,
    day: match.day,
    matchNumber: match.matchNumber,
    round: match.round,
    teams: [match.teams?.[0] || "", match.teams?.[1] || "", match.teams?.[2] || ""],
    activeCategory: match.activeCategory || "sprint",
  };

  $("match-id").value = draft.id;
  $("match-round").value = draft.round;
  $("match-day").value = draft.day;
  $("match-number").value = draft.matchNumber;

  for (let i = 0; i < 3; i += 1) {
    const select = $(`match-team-${i}`);
    select.innerHTML = teamOptionHtml(draft.teams[i]);
    select.value = draft.teams[i];
  }

  $("match-form-empty").classList.add("hidden");
  $("match-form").classList.remove("hidden");
  setDirty(false);
}

function readFormIntoDraft() {
  if (!draft) return;
  draft.round = $("match-round").value.trim();
  draft.day = Number($("match-day").value) || 1;
  draft.matchNumber = Number($("match-number").value) || 1;
  draft.teams = [0, 1, 2].map((i) => $(`match-team-${i}`).value || "");
}

async function selectMatch(matchId) {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  selectedId = matchId;
  renderList();
  const data = await api(`/api/matches/${encodeURIComponent(matchId)}`);
  teams = data.teams ?? teams;
  fillForm(data.match);
}

async function refreshList(keepSelection = true) {
  const data = await api("/api/matches");
  matches = data.matches ?? [];
  teams = data.teams ?? [];
  renderList();
  if (keepSelection && selectedId) {
    const still = matches.find((m) => m.id === selectedId);
    if (still) renderList();
  }
}

async function saveMatch(event) {
  event?.preventDefault();
  if (!draft) return;
  readFormIntoDraft();
  try {
    const data = await api(`/api/matches/${encodeURIComponent(draft.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day: draft.day,
        matchNumber: draft.matchNumber,
        round: draft.round,
        teams: draft.teams,
        activeCategory: draft.activeCategory,
      }),
    });
    fillForm(data.match);
    await refreshList();
    setStatus("Saved.");
  } catch (err) {
    setStatus(err.message, true);
  }
}

$("match-list").addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-match-id]");
  if (!btn) return;
  try {
    await selectMatch(btn.dataset.matchId);
  } catch (err) {
    setStatus(err.message, true);
  }
});

$("match-form").addEventListener("input", () => {
  if (!draft) return;
  readFormIntoDraft();
  setDirty(true);
});

$("match-form").addEventListener("change", () => {
  if (!draft) return;
  readFormIntoDraft();
  setDirty(true);
});

$("match-form").addEventListener("submit", saveMatch);

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    if (!draft) return;
    event.preventDefault();
    saveMatch();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

refreshList().catch((err) => setStatus(err.message, true));
