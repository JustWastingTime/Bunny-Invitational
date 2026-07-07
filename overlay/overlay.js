const POLL_MS = 1000;

const CATEGORY_LABELS = {
  sprint: "Sprint",
  mile: "Mile",
  medium: "Medium",
  long: "Long",
  dirt: "Dirt",
};

const STYLE_SHORT = {
  nige: "N",
  senkou: "S",
  sashi: "A",
  oikomi: "O",
};
const CATEGORY_KEYS = {
  "1": "sprint",
  "2": "mile",
  "3": "medium",
  "4": "long",
  "5": "dirt",
};

const $ = (id) => document.getElementById(id);

function gateClass(gate) {
  if (gate == null) return "empty";
  return `gate-${gate}`;
}

function portraitHtml(spriteId, teamColor, umaName) {
  const safeId = String(spriteId ?? "").trim();
  const src = safeId ? `/assets/characters/${safeId}.png` : "";
  const initial = (umaName || "?").charAt(0).toUpperCase();
  const onError = "const base=this.dataset.base||'';const exts=['png','webp','jpg','jpeg'];const i=Number(this.dataset.i||0)+1;if(base&&i<exts.length){this.dataset.i=String(i);this.src=`/assets/characters/${base}.${exts[i]}`;return;}this.replaceWith(Object.assign(document.createElement('div'),{className:'portrait-fallback',textContent:this.dataset.initial||'?'}));";

  if (!safeId) {
    return `
    <div class="portrait-wrap" style="--team-color: ${teamColor}">
      <div class="portrait-fallback">${initial}</div>
    </div>`;
  }

  return `
    <div class="portrait-wrap" style="--team-color: ${teamColor}">
      <img
        class="portrait"
        src="${src}"
        alt=""
        data-base="${safeId}"
        data-i="0"
        data-initial="${initial}"
        onerror="${onError}"
      />
    </div>`;
}

function portraitHtmlFromPath(spritePath, spriteId, teamColor, umaName) {
  if (spritePath) {
    const initial = (umaName || "?").charAt(0).toUpperCase();
    return `
    <div class="portrait-wrap" style="--team-color: ${teamColor}">
      <img
        class="portrait"
        src="${spritePath}"
        alt=""
        data-initial="${initial}"
        onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'portrait-fallback',textContent:this.dataset.initial||'?'}))"
      />
    </div>`;
  }
  return portraitHtml(spriteId, teamColor, umaName);
}

function runstyleIconHtml(style) {
  const key = String(style ?? "").toLowerCase();
  const short = STYLE_SHORT[key] ?? "?";
  const src = `/assets/ui/runstyles/${key}.png`;
  return `
    <span class="style-icon-wrap">
      <img
        class="style-icon"
        src="${src}"
        alt="${key}"
        onerror="this.remove();"
      />
      <span class="style-icon-fallback">${short}</span>
    </span>`;
}

function entryRow(entry, teamIndex, rowIndex) {
  const slotValue = entry.gate ?? teamIndex * 3 + rowIndex + 1;
  return `
    <div class="entry-row">
      ${portraitHtmlFromPath(entry.uma.spritePath, entry.uma.spriteId ?? entry.uma.characterId, entry.teamColor, entry.uma.name)}
      <div class="entry-info">
        <div class="uma-name">${entry.uma.name}</div>
        <div class="trainer-row">
          ${runstyleIconHtml(entry.uma.style)}
          <span class="trainer-name">${entry.trainer}</span>
        </div>
      </div>
      <div class="slot-wrap">
        <div class="slot-label">Slot</div>
        <div class="gate-badge ${gateClass(slotValue)}">${slotValue}</div>
      </div>
    </div>`;
}

function teamColumn(team, teamIndex) {
  const sortedEntries = [...team.entries].sort((a, b) => {
    const aOrder = a.gate ?? a.slot ?? 99;
    const bOrder = b.gate ?? b.slot ?? 99;
    return aOrder - bOrder;
  });

  return `
    <section class="team-column" style="--team-color: ${team.color}">
      <header class="team-header">
        <div class="team-name">${team.name}</div>
      </header>
      <div class="entries">
        ${sortedEntries.map((entry, idx) => entryRow(entry, teamIndex, idx)).join("")}
      </div>
    </section>`;
}

function render(data) {
  if (!data) return;

  if (data.visible === false) {
    $("overlay").classList.add("hidden");
    return;
  }

  $("day-label").textContent = `Day ${data.day}`;
  $("match-label").textContent = `Match ${data.matchNumber}`;
  $("category-label").textContent = CATEGORY_LABELS[data.category] || data.category;
  $("round-label").textContent = data.round;

  $("teams-panel").innerHTML = data.teams.map(teamColumn).join("");
  $("overlay").classList.remove("hidden");
}

async function fetchOverlay() {
  try {
    const res = await fetch("/api/overlay", { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (err) {
    console.warn("Overlay fetch failed:", err);
    return null;
  }
}

let lastJson = "";

async function tick() {
  const data = await fetchOverlay();
  if (!data) return;

  const json = JSON.stringify(data);
  if (json !== lastJson) {
    lastJson = json;
    render(data);
  }
}

tick();
setInterval(tick, POLL_MS);

window.addEventListener("keydown", async (event) => {
  const key = event.key.toLowerCase();

  if (key === "h") {
    try {
      await fetch("/api/overlay/visibility?action=toggle", { method: "POST" });
    } catch (err) {
      console.warn("Visibility toggle failed:", err);
    }
    return;
  }

  const category = CATEGORY_KEYS[key];
  if (!category) return;
  try {
    await fetch(`/api/overlay/category?value=${category}`, { method: "POST" });
  } catch (err) {
    console.warn("Category switch failed:", err);
  }
});
