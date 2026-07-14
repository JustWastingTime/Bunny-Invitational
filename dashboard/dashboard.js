const CATEGORIES = [
  { key: "sprint", label: "Sprint" },
  { key: "mile", label: "Mile" },
  { key: "medium", label: "Medium" },
  { key: "long", label: "Long" },
  { key: "dirt", label: "Dirt" },
];

const $ = (id) => document.getElementById(id);
let selectedPlace = "1";

async function api(path, options = {}) {
  const res = await fetch(path, { cache: "no-store", ...options });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function racerKey(teamId, slot) {
  return `${teamId}:${slot}`;
}

function portraitHtml(racer) {
  const initial = (racer.umaName || "?").charAt(0).toUpperCase();
  if (racer.spritePath) {
    return `<img class="racer-portrait" src="${racer.spritePath}" alt="" data-initial="${initial}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'racer-portrait fallback',textContent:this.dataset.initial||'?'}))" />`;
  }
  return `<div class="racer-portrait fallback">${initial}</div>`;
}

function renderCategoryButtons(activeCategory) {
  $("category-buttons").innerHTML = CATEGORIES.map(
    (cat) => `<button type="button" data-category="${cat.key}" class="${cat.key === activeCategory ? "active" : ""}">${cat.label}</button>`
  ).join("");
}

function renderPodium(state) {
  const placements = state.currentRace.placements;
  $("podium-slots").innerHTML = ["1", "2", "3"]
    .map((place) => {
      const pick = placements[place];
      const pts = state.scoring?.place?.[place] ?? "?";
      const label = place === "1" ? "1st" : place === "2" ? "2nd" : "3rd";
      const body = pick
        ? `<div class="podium-pick">
             ${pick.spritePath ? `<img class="podium-portrait" src="${pick.spritePath}" alt="" />` : ""}
             <div>
               <div class="podium-name">${pick.trainer}</div>
               <div class="podium-meta">${pick.umaName} · ${pick.teamName}</div>
             </div>
           </div>`
        : `<div class="podium-empty">—</div>`;
      return `<article class="podium-slot ${selectedPlace === place ? "selected" : ""}" data-place="${place}">
        <div class="podium-head">${label} <span class="podium-pts">${pts}pt</span></div>
        ${body}
        ${pick ? `<button type="button" class="podium-clear" data-clear-place="${place}">Clear</button>` : ""}
      </article>`;
    })
    .join("");
}

function renderTeamColumns(state) {
  const assigned = new Set();
  for (const place of ["1", "2", "3"]) {
    const pick = state.currentRace.placements[place];
    if (pick) assigned.add(racerKey(pick.teamId, pick.slot));
  }

  $("team-columns").innerHTML = state.currentRace.teams
    .map(
      (team) => `<section class="team-column" style="--team-color: ${team.color}">
        <header class="team-column-header">${team.name}</header>
        <div class="team-racers">
          ${team.racers
            .map((racer) => {
              const key = racerKey(racer.teamId, racer.slot);
              const isAssigned = assigned.has(key);
              return `<button type="button" class="racer-btn ${isAssigned ? "assigned" : ""}"
                data-team="${racer.teamId}" data-slot="${racer.slot}"
                title="${racer.trainer} — ${racer.umaName}">
                ${portraitHtml(racer)}
                <span class="racer-text">
                  <span class="racer-trainer">${racer.trainer}</span>
                  <span class="racer-uma">${racer.umaName}</span>
                </span>
              </button>`;
            })
            .join("")}
        </div>
      </section>`
    )
    .join("");
}

function renderStandings(standings, scoring) {
  $("standings-body").innerHTML = standings.teams
    .map(
      (team) => `<tr>
      <td>${team.name}</td>
      <td>${team.firsts ?? 0}</td>
      <td>${team.seconds ?? 0}</td>
      <td>${team.thirds ?? 0}</td>
      <td>${team.points}</td>
    </tr>`
    )
    .join("");

  const p = scoring?.place ?? {};
  $("scoring-hint").textContent = `Scoring: 1st = ${p["1"] ?? "?"}pt, 2nd = ${p["2"] ?? "?"}pt, 3rd = ${p["3"] ?? "?"}pt (editable in data/standings.json)`;
}

function renderMatchSelect(state) {
  $("match-select").innerHTML = state.matches
    .map((m) => {
      const label = `Day ${m.day} Match ${m.matchNumber} — ${m.round}`;
      const selected = m.id === state.activeMatch ? "selected" : "";
      return `<option value="${m.id}" ${selected}>${label}</option>`;
    })
    .join("");
}

function render(state) {
  renderMatchSelect(state);
  renderCategoryButtons(state.activeCategory);
  renderPodium(state);
  renderTeamColumns(state);
  renderStandings(state.standings, state.scoring);

  const cat = CATEGORIES.find((c) => c.key === state.activeCategory);
  $("current-category-label").textContent = cat?.label ?? state.activeCategory;

  const status = $("overlay-status");
  status.textContent = `Overlay: ${state.overlayVisible ? "ON" : "OFF"}`;
  status.classList.toggle("off", !state.overlayVisible);

  const transitionBtn = $("scene-transition-toggle");
  transitionBtn.classList.toggle("active", Boolean(state.sceneTransition));
  transitionBtn.textContent = state.sceneTransition ? "End Scene Transition" : "Scene Transition";

  document.querySelectorAll(".place-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.place === selectedPlace);
  });
}

async function refresh() {
  const state = await api("/api/dashboard");
  render(state);
}

$("match-select").addEventListener("change", async (event) => {
  await api(`/api/dashboard/active-match?value=${event.target.value}`, { method: "POST" });
  await refresh();
});

$("category-buttons").addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-category]");
  if (!btn) return;
  await api(`/api/overlay/category?value=${btn.dataset.category}`, { method: "POST" });
  await refresh();
});

document.querySelector(".place-select").addEventListener("click", (event) => {
  const btn = event.target.closest(".place-btn");
  if (!btn) return;
  selectedPlace = btn.dataset.place;
  refresh();
});

$("podium-slots").addEventListener("click", async (event) => {
  const clearBtn = event.target.closest("[data-clear-place]");
  if (clearBtn) {
    const state = await api("/api/dashboard");
    await api("/api/dashboard/placement/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: state.activeMatch,
        category: state.activeCategory,
        place: clearBtn.dataset.clearPlace,
      }),
    });
    await refresh();
    return;
  }

  const slot = event.target.closest(".podium-slot");
  if (slot) {
    selectedPlace = slot.dataset.place;
    refresh();
  }
});

$("team-columns").addEventListener("click", async (event) => {
  const btn = event.target.closest(".racer-btn");
  if (!btn) return;
  const state = await api("/api/dashboard");
  await api("/api/dashboard/placement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      matchId: state.activeMatch,
      category: state.activeCategory,
      place: selectedPlace,
      teamId: btn.dataset.team,
      slot: Number(btn.dataset.slot),
    }),
  });
  await refresh();
});

$("clear-placements").addEventListener("click", async () => {
  const state = await api("/api/dashboard");
  await api("/api/dashboard/placement/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      matchId: state.activeMatch,
      category: state.activeCategory,
    }),
  });
  await refresh();
});

$("overlay-hide").addEventListener("click", async () => {
  await api("/api/overlay/visibility?action=hide", { method: "POST" });
  await refresh();
});

$("overlay-show").addEventListener("click", async () => {
  await api("/api/overlay/visibility?action=show", { method: "POST" });
  await refresh();
});

$("scene-transition-toggle").addEventListener("click", async () => {
  await api("/api/overlay/scene-transition?action=toggle", { method: "POST" });
  await refresh();
});

refresh();
setInterval(refresh, 2000);
