import { refreshTeamsPage, setupTeamsPage } from "./teams-page.js";

const VIEWS = ["bracket", "results", "teams", "stats"];
let state = {
  tournament: "Bunny Invitational",
  updatedAt: null,
  standings: [],
  teams: [],
  matches: [],
  stats: { popularity: [], uniqueUmas: [] },
  scoring: { place: { "1": 5, "2": 3, "3": 1 } },
};
let bracketLayout = null;
let selectedMatchId = null;

async function loadPublicData() {
  const res = await fetch("./data/public.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load website/data/public.json");
  return res.json();
}

async function loadBracketLayout() {
  try {
    const res = await fetch("./data/bracket-layout.json", { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function formatUpdatedAt(value) {
  if (!value) return "Waiting for first result";
  return `Updated ${new Date(value).toLocaleString()}`;
}

function matchTeamRows(match) {
  const pointsByTeam = new Map(match.teams.map((teamId) => [teamId, 0]));
  const scoring = state.scoring?.place ?? { "1": 5, "2": 3, "3": 1 };

  for (const category of Object.keys(match.categories ?? {})) {
    const race = match.categories[category];
    for (const place of ["1", "2", "3"]) {
      const pick = race.placements?.[place];
      if (!pick?.teamId) continue;
      pointsByTeam.set(pick.teamId, (pointsByTeam.get(pick.teamId) ?? 0) + (scoring[place] ?? 0));
    }
  }

  return match.teams
    .map((teamId) => {
      const team = state.teams.find((row) => row.id === teamId) ?? { id: teamId, name: teamId, color: "#999" };
      return { ...team, matchPoints: pointsByTeam.get(teamId) ?? 0 };
    })
    .sort((a, b) => b.matchPoints - a.matchPoints);
}

function matchStatus(match) {
  const totalRaces = Object.keys(match.categories ?? {}).length;
  let decided = 0;
  for (const category of Object.keys(match.categories ?? {})) {
    if (match.categories[category]?.placements?.["1"]) decided += 1;
  }
  return `${decided}/${totalRaces} races scored`;
}

function racerKeyOf(racer) {
  return racer?.key ?? `${racer?.teamId}:${racer?.slot}`;
}

function podiumMap(placements) {
  const map = new Map();
  for (const place of ["1", "2", "3"]) {
    const pick = placements?.[place];
    if (!pick) continue;
    map.set(racerKeyOf(pick), Number(place));
  }
  return map;
}

const ICON_CROWN = `<svg class="race-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 15.5 2.5 8l3.6 2.6L12 5l5.9 5.6L21.5 8 20 15.5H4zm0 2.5h16v2H4v-2z"/></svg>`;
const ICON_STAR = `<svg class="race-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.2 14.8 9H22l-6.2 4.5 2.4 7.3L12 17.3 5.8 20.8 8.2 13.5 2 9h7.2z"/></svg>`;

function resolveAssetPath(spritePath) {
  if (!spritePath) return null;
  if (/^https?:\/\//i.test(spritePath)) return spritePath;
  if (spritePath.startsWith("assets/")) return `./${spritePath}`;
  const file = String(spritePath).split("/").pop();
  return file ? `./assets/characters/${file}` : null;
}

function renderRacerCard(racer, podium, uniqueSet) {
  const key = racerKeyOf(racer);
  const place = podium.get(key) ?? null;
  const podiumClass = place ? `place-${place}` : "";
  const placeTitle = place === 1 ? "1st place" : place === 2 ? "2nd place" : place === 3 ? "3rd place" : "";
  const isUnique = uniqueSet.has(racer.umaName);
  const uniquePodiumBonus = Boolean(place && isUnique);
  const initial = (racer.umaName ?? "?").charAt(0).toUpperCase();
  const portraitSrc = resolveAssetPath(racer.spritePath);
  const titleParts = [
    racer.trainer,
    placeTitle || null,
    isUnique ? (uniquePodiumBonus ? "Unique (podium bonus)" : "Unique uma") : null,
  ].filter(Boolean);
  return `
    <article class="race-card ${podiumClass}${isUnique ? " is-unique" : ""}" title="${titleParts.join(" · ")}">
      <div class="race-portrait-wrap">
        ${
          portraitSrc
            ? `<img class="race-portrait" src="${portraitSrc}" alt="${racer.umaName}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'race-portrait fallback',textContent:this.dataset.initial||'?'}))" data-initial="${initial}" />`
            : `<div class="race-portrait fallback">${initial}</div>`
        }
        ${place ? `<span class="podium-badge ${podiumClass}" title="${placeTitle}">${ICON_CROWN}</span>` : ""}
        ${isUnique ? `<span class="race-icon race-icon-star" title="${uniquePodiumBonus ? "Unique podium bonus" : "Unique uma"}">${ICON_STAR}</span>` : ""}
      </div>
      <div class="race-card-divider" aria-hidden="true"></div>
      <div class="race-trainer">${racer.trainer}</div>
    </article>
  `;
}

const CATEGORY_ORDER = ["sprint", "mile", "medium", "long", "dirt"];

function orderedCategoryEntries(categories) {
  const rows = CATEGORY_ORDER.filter((key) => categories?.[key]).map((key) => [key, categories[key]]);
  for (const [key, race] of Object.entries(categories ?? {})) {
    if (!CATEGORY_ORDER.includes(key)) rows.push([key, race]);
  }
  return rows;
}

function getDefaultLayout() {
  return {
    width: 1200,
    height: 760,
    battleWidth: 200,
    battleHeight: 78,
    battles: [
      { id: "group-a-match-1", label: "Group A Match 1", x: 60, y: 540, matchId: null },
      { id: "group-a-match-2", label: "Group A Match 2", x: 60, y: 640, matchId: null },
      { id: "group-b-match-1", label: "Group B Match 1", x: 940, y: 540, matchId: null },
      { id: "group-b-match-2", label: "Group B Match 2", x: 940, y: 640, matchId: null },
      { id: "group-a-match-3-middle", label: "Group A Match 3 (MIDDLE)", x: 330, y: 430, matchId: null },
      { id: "group-b-middle-3-middle", label: "Group B Middle 3 (MIDDLE)", x: 670, y: 430, matchId: null },
      { id: "group-a-second-stage", label: "Group A Second Stage", x: 60, y: 300, matchId: null },
      { id: "group-b-second-stage", label: "Group B Second Stage", x: 940, y: 300, matchId: null },
      { id: "group-a-semi", label: "Group A Semi", x: 220, y: 180, matchId: null },
      { id: "group-b-semi", label: "Group B Semi", x: 780, y: 180, matchId: null },
      { id: "lower-finals", label: "Lower Finals", x: 500, y: 180, matchId: null },
      { id: "finals", label: "Finals", x: 500, y: 40, matchId: null },
    ],
    links: [
      { from: "group-a-match-1", to: "group-a-semi", result: "1" },
      { from: "group-a-match-2", to: "group-a-semi", result: "1" },
      { from: "group-b-match-1", to: "group-b-semi", result: "1" },
      { from: "group-b-match-2", to: "group-b-semi", result: "1" },
      { from: "group-a-match-1", to: "group-a-second-stage", result: "2" },
      { from: "group-a-match-2", to: "group-a-second-stage", result: "2" },
      { from: "group-b-match-1", to: "group-b-second-stage", result: "2" },
      { from: "group-b-match-2", to: "group-b-second-stage", result: "2" },
      { from: "group-a-match-1", to: "group-a-match-3-middle", result: "3" },
      { from: "group-a-match-2", to: "group-a-match-3-middle", result: "3" },
      { from: "group-b-match-1", to: "group-b-middle-3-middle", result: "3" },
      { from: "group-b-match-2", to: "group-b-middle-3-middle", result: "3" },
      { from: "group-a-match-3-middle", to: "group-b-second-stage", result: "cross" },
      { from: "group-b-middle-3-middle", to: "group-a-second-stage", result: "cross" },
      { from: "group-a-second-stage", to: "group-a-semi", result: "1" },
      { from: "group-b-second-stage", to: "group-b-semi", result: "1" },
      { from: "group-a-semi", to: "finals", result: "1" },
      { from: "group-b-semi", to: "finals", result: "1" },
      { from: "group-a-semi", to: "lower-finals", result: "2" },
      { from: "group-b-semi", to: "lower-finals", result: "2" },
      { from: "lower-finals", to: "finals", result: "1" },
    ],
  };
}

function buildBracketConfig(matches) {
  const defaults = getDefaultLayout();
  if (!bracketLayout?.battles) {
    return {
      ...defaults,
      battles: defaults.battles.map((battle, idx) => ({ ...battle, matchId: matches[idx]?.id ?? null })),
    };
  }

  const customById = Object.fromEntries(bracketLayout.battles.map((battle) => [battle.id, battle]));
  return {
    width: bracketLayout.width ?? defaults.width,
    height: bracketLayout.height ?? defaults.height,
    battleWidth: bracketLayout.battleWidth ?? defaults.battleWidth,
    battleHeight: bracketLayout.battleHeight ?? defaults.battleHeight,
    links: bracketLayout.links ?? defaults.links,
    battles: defaults.battles.map((battle, idx) => {
      const custom = customById[battle.id] ?? {};
      return {
        ...battle,
        ...custom,
        matchId: custom.matchId ?? battle.matchId ?? matches[idx]?.id ?? null,
      };
    }),
  };
}

function getLinkStroke(link) {
  if (link.result === "2") return "link-second";
  if (link.result === "3") return "link-third";
  if (link.result === "cross") return "link-cross";
  return "link-first";
}

function getLinkMarker(link) {
  if (link.result === "2") return "url(#arrow-second)";
  if (link.result === "3") return "url(#arrow-third)";
  if (link.result === "cross") return "url(#arrow-cross)";
  return "url(#arrow-first)";
}

function anchorPoint(node, battleWidth, battleHeight, anchor) {
  const ax = node.x;
  const ay = node.y;
  if (anchor === "top") return [ax + battleWidth / 2, ay];
  if (anchor === "bottom") return [ax + battleWidth / 2, ay + battleHeight];
  if (anchor === "left") return [ax, ay + battleHeight / 2];
  if (anchor === "right") return [ax + battleWidth, ay + battleHeight / 2];
  return [ax + battleWidth / 2, ay + battleHeight / 2];
}

function buildPathFromPoints(points) {
  if (!points.length) return "";
  const [start, ...rest] = points;
  return `M ${start[0]} ${start[1]} ${rest.map((point) => `L ${point[0]} ${point[1]}`).join(" ")}`;
}

function getConnectorPath(link, from, to, battleWidth, battleHeight) {
  if (Array.isArray(link.points) && link.points.length >= 2) {
    return buildPathFromPoints(link.points);
  }

  const [sx, sy] = anchorPoint(from, battleWidth, battleHeight, link.fromAnchor ?? "right");
  const [tx, ty] = anchorPoint(to, battleWidth, battleHeight, link.toAnchor ?? "left");
  const dx = tx - sx;
  const dy = ty - sy;

  if (Math.abs(dx) < 80) {
    const midY = sy + dy / 2;
    return buildPathFromPoints([
      [sx, sy],
      [sx, midY],
      [tx, midY],
      [tx, ty],
    ]);
  }

  const midX = sx + dx / 2;
  return buildPathFromPoints([
    [sx, sy],
    [midX, sy],
    [midX, ty],
    [tx, ty],
  ]);
}

function renderMatchDetail(matchId) {
  const container = document.getElementById("match-detail");
  const match = state.matches.find((row) => row.id === matchId);
  if (!match) {
    container.innerHTML = `
      <h2>Bracket Match Detail</h2>
      <p>Click any match box below to inspect head-to-head and race winners.</p>
    `;
    return;
  }

  const teamRows = matchTeamRows(match);
  const uniqueSet = new Set(state.stats?.uniqueUmas ?? []);
  const rankByTeam = new Map(teamRows.map((team, idx) => [team.id, idx + 1]));
  const pointsByTeam = new Map(teamRows.map((team) => [team.id, team.matchPoints]));

  const teamColumns = match.teams
    .map((teamId) => {
      const team = state.teams.find((row) => row.id === teamId) ?? {
        id: teamId,
        name: teamId,
        shortName: teamId,
        color: "#999",
      };
      const rank = rankByTeam.get(teamId) ?? null;
      const points = pointsByTeam.get(teamId) ?? 0;
      const categoryBlocks = orderedCategoryEntries(match.categories)
        .map(([category, race]) => {
          const podium = podiumMap(race.placements);
          const racers = (race.racers ?? [])
            .filter((racer) => racer.teamId === teamId)
            .sort((a, b) => a.slot - b.slot);
          const cards = racers.map((racer) => renderRacerCard(racer, podium, uniqueSet)).join("");
          return `
            <div class="team-col-race">
              <div class="team-col-race-label">${category}</div>
              <div class="team-col-racers">${cards}</div>
            </div>
          `;
        })
        .join("");

      return `
        <section class="team-col rank-${rank ?? ""}" style="--team:${team.color}">
          <header class="team-col-head">
            <div class="team-col-title">
              ${rank ? `<span class="team-col-rank">#${rank}</span>` : ""}
              <div>
                <div class="team-col-name">${team.name}</div>
                <div class="team-col-short">${team.shortName ?? ""}</div>
              </div>
            </div>
            <div class="team-col-points"><strong>${points}</strong><span>pts</span></div>
          </header>
          <div class="team-col-body">${categoryBlocks}</div>
        </section>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="match-detail-top">
      <div>
        <h2>Day ${match.day} Match ${match.matchNumber} — ${match.round}</h2>
        <p>${matchStatus(match)}</p>
      </div>
    </div>
    <div class="match-team-board">${teamColumns}</div>
  `;
}

function renderBracket() {
  const layout = buildBracketConfig(state.matches);
  const container = document.getElementById("bracket-grid");
  const battleById = Object.fromEntries(layout.battles.map((battle) => [battle.id, battle]));
  const paths = (layout.links ?? [])
    .map((link) => {
      const from = battleById[link.from];
      const to = battleById[link.to];
      if (!from || !to) return "";
      return `<path class="${getLinkStroke(link)}" marker-end="${getLinkMarker(link)}" d="${getConnectorPath(link, from, to, layout.battleWidth, layout.battleHeight)}" />`;
    })
    .join("");

  const nodes = layout.battles
    .map((battle) => {
      const match = state.matches.find((row) => row.id === battle.matchId);
      const teams = match
        ? match.teams.map((teamId) => state.teams.find((row) => row.id === teamId)?.shortName ?? teamId).join(" vs ")
        : "TBD";
      const status = match ? matchStatus(match) : "Unassigned";
      const selected = battle.matchId && battle.matchId === selectedMatchId;
      return `
        <button
          class="match-box chart-node ${selected ? "selected" : ""}"
          data-match-id="${battle.matchId ?? ""}"
          ${match ? "" : "disabled"}
          style="left:${battle.x}px;top:${battle.y}px;width:${layout.battleWidth}px;height:${layout.battleHeight}px;"
        >
          <div class="match-label">${battle.label}</div>
          <div class="match-teams">${teams}</div>
          <div class="match-status">${status}</div>
        </button>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="bracket-canvas" style="width:${layout.width}px;height:${layout.height}px;">
      <svg class="bracket-lines" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="none">
        <defs>
          <marker id="arrow-first" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(240, 197, 92, 0.95)" />
          </marker>
          <marker id="arrow-second" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(162, 168, 188, 0.95)" />
          </marker>
          <marker id="arrow-third" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(238, 241, 255, 0.92)" />
          </marker>
          <marker id="arrow-cross" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(240, 197, 92, 0.95)" />
          </marker>
        </defs>
        ${paths}
      </svg>
      ${nodes}
      <aside class="bracket-legend">
        <h4>Legend</h4>
        <div><span class="legend-line legend-first"></span> 1st place</div>
        <div><span class="legend-line legend-second"></span> 2nd place</div>
        <div><span class="legend-line legend-third"></span> 3rd place</div>
        <div><span class="legend-line legend-cross"></span> Winner crossing</div>
      </aside>
    </div>
  `;
}

function renderResults() {
  document.getElementById("standings-body").innerHTML = state.standings
    .map(
      (team, idx) => `<tr>
        <td>${idx + 1}</td>
        <td>${team.name}</td>
        <td>${team.firsts ?? 0}</td>
        <td>${team.seconds ?? 0}</td>
        <td>${team.thirds ?? 0}</td>
        <td>${team.points ?? 0}</td>
      </tr>`
    )
    .join("");
}

function renderTeams() {
  refreshTeamsPage();
}

function renderStats() {
  const stats = state.stats ?? {};
  const mostCommon = stats.mostCommonUma;
  const bestWinRate = stats.bestWinRateUma;
  document.getElementById("stats-grid").innerHTML = `
    <article class="stat-card"><h3>Unique Umas</h3><p>${stats.uniqueUmaCount ?? 0}</p></article>
    <article class="stat-card"><h3>Total Matches</h3><p>${stats.totalMatches ?? 0}</p></article>
    <article class="stat-card"><h3>Most Common Uma</h3><p>${mostCommon ? `${mostCommon.umaName} (${mostCommon.starts})` : "—"}</p></article>
    <article class="stat-card"><h3>Highest Win Rate</h3><p>${bestWinRate ? `${bestWinRate.umaName} (${Math.round(bestWinRate.winRate * 100)}%)` : "—"}</p></article>
  `;

  document.getElementById("popularity-body").innerHTML = (stats.popularity ?? [])
    .slice(0, 20)
    .map(
      (row) => `<tr>
        <td>${row.umaName}</td>
        <td>${row.starts}</td>
        <td>${row.wins}</td>
        <td>${Math.round((row.winRate ?? 0) * 100)}%</td>
      </tr>`
    )
    .join("");
}

function render() {
  document.getElementById("tournament-name").textContent = state.tournament ?? "Bunny Invitational";
  document.getElementById("updated-at").textContent = formatUpdatedAt(state.updatedAt);
  renderBracket();
  renderMatchDetail(selectedMatchId);
  renderResults();
  renderTeams();
  renderStats();
}

function activateView(tab) {
  const active = VIEWS.includes(tab) ? tab : "bracket";
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).classList.toggle("hidden", view !== active);
  }
  document.querySelectorAll("[data-tab]").forEach((link) => {
    link.classList.toggle("active", link.dataset.tab === active);
  });
}

function setupInteractions() {
  window.addEventListener("hashchange", () => activateView(window.location.hash.replace("#", "")));
  document.getElementById("bracket-grid").addEventListener("click", (event) => {
    const button = event.target.closest(".match-box[data-match-id]");
    if (!button || !button.dataset.matchId) return;
    selectedMatchId = button.dataset.matchId;
    renderMatchDetail(selectedMatchId);
    document.querySelectorAll(".match-box.chart-node").forEach((node) => {
      node.classList.toggle("selected", node.dataset.matchId === selectedMatchId);
    });
  });
}

async function tick() {
  try {
    const [data, layout] = await Promise.all([loadPublicData(), loadBracketLayout()]);
    state = data;
    bracketLayout = layout;
    render();
    activateView(window.location.hash.replace("#", ""));
  } catch (err) {
    document.getElementById("updated-at").textContent = "Website data unavailable";
    console.warn(err);
  }
}

setupInteractions();
setupTeamsPage();
tick();
setInterval(tick, 15000);
