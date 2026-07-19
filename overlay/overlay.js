const POLL_MS = 1000;

const SCENE_BR_BASE_DELAY = 0.22;

/** Heights are % of the rotated stage — pack edge-to-edge so green/white fully cover. */
const SCENE_BAR_PATTERN = [
  { height: 7.5, tone: "green" },
  { height: 3.2, tone: "white" },
  { height: 9.0, tone: "green" },
  { height: 2.8, tone: "white" },
  { height: 6.5, tone: "green" },
  { height: 3.5, tone: "white" },
  { height: 8.2, tone: "green" },
  { height: 2.5, tone: "white" },
  { height: 7.0, tone: "green" },
  { height: 3.0, tone: "white" },
];

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleInPlace(arr, seed) {
  const next = makeRng(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildSceneTransitionBars() {
  const overlap = 0.6;
  const rows = [];
  let top = -8;
  let index = 0;

  while (top < 108) {
    const { height, tone } = SCENE_BAR_PATTERN[index % SCENE_BAR_PATTERN.length];
    rows.push({ height, tone, top });
    top += height - overlap;
    index += 1;
  }

  // Balanced TL/BR deck, shuffled independently of tone so greens and whites come from both corners.
  const origins = rows.map((_, idx) => (idx < Math.ceil(rows.length / 2) ? "tl" : "br"));
  shuffleInPlace(origins, 0x9e3779b9);

  const timingRng = makeRng(0xc0ffee);
  const randRange = (min, max) => min + timingRng() * (max - min);

  return rows.map((row, idx) => {
    const origin = origins[idx];
    // Wave-ish base + noise so bars don't lock-step; BR wave starts a bit later.
    const wave = (idx / Math.max(rows.length - 1, 1)) * 0.18;
    const enterDelay =
      (origin === "tl" ? 0 : SCENE_BR_BASE_DELAY) + wave * 0.55 + randRange(0, 0.28);
    const exitDelay = randRange(0, 0.42) + (origin === "br" ? 0.06 : 0);
    const enterDur = randRange(0.48, 0.92);
    const exitDur = randRange(0.42, 0.86);
    return {
      origin,
      tone: row.tone,
      height: row.height,
      top: row.top,
      enterDelay,
      exitDelay,
      enterDur,
      exitDur,
    };
  });
}

const SCENE_TRANSITION_BARS = buildSceneTransitionBars();
const SCENE_ENTER_MS = Math.ceil(
  Math.max(...SCENE_TRANSITION_BARS.map((bar) => (bar.enterDelay + bar.enterDur) * 1000)) + 80
);
const SCENE_EXIT_MS = Math.ceil(
  Math.max(...SCENE_TRANSITION_BARS.map((bar) => (bar.exitDelay + bar.exitDur) * 1000)) + 80
);

const CATEGORY_LABELS = {
  sprint: "Sprint",
  mile: "Mile",
  medium: "Medium",
  long: "Long",
  dirt: "Dirt",
  dirt2: "Dirt 2",
  medium2: "Medium 2",
};

const STYLE_SHORT = {
  runaway: "R",
  front: "F",
  pace: "P",
  late: "L",
  end: "E",
  // legacy JP keys
  nige: "R",
  senkou: "F",
  sashi: "P",
  oikomi: "E",
};

const STYLE_ASSET = {
  runaway: "runaway",
  front: "front",
  pace: "pace",
  late: "late",
  end: "end",
  nige: "runaway",
  senkou: "front",
  sashi: "pace",
  oikomi: "end",
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
  const asset = STYLE_ASSET[key] ?? key;
  const short = STYLE_SHORT[key] ?? "?";
  const src = `/assets/runstyle/${asset}.png`;
  return `
    <span class="style-icon-wrap" title="${asset}">
      <img
        class="style-icon"
        src="${src}"
        alt="${asset}"
        data-base="${asset}"
        onerror="const b=this.dataset.base;if(!this.dataset.webp){this.dataset.webp='1';this.src='/assets/runstyle/'+b+'.webp';return;}this.remove();"
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
          <span class="trainer-name">${entry.trainer}</span>
        </div>
      </div>
      ${runstyleIconHtml(entry.uma.style)}
      <div class="slot-wrap">
        <div class="slot-label">Slot</div>
        <div class="gate-badge ${gateClass(slotValue)}">${slotValue}</div>
      </div>
    </div>`;
}

function teamColumn(team, teamIndex) {
  // Keep roster/slot order (same as dashboard) — do not sort by gate.
  const entries = [...team.entries].sort(
    (a, b) => (a.slot ?? 99) - (b.slot ?? 99)
  );

  return `
    <section class="team-column" style="--team-color: ${team.color}">
      <header class="team-header">
        <div class="team-name">${team.name}</div>
      </header>
      <div class="entries">
        ${entries.map((entry, idx) => entryRow(entry, teamIndex, idx)).join("")}
      </div>
    </section>`;
}

function applyOverlayContent(data) {
  $("day-label").textContent = `Day ${data.day}`;
  $("match-label").textContent = `Match ${data.matchNumber}`;
  $("category-label").textContent = CATEGORY_LABELS[data.category] || data.category;
  $("round-label").textContent = data.round;
  $("teams-panel").innerHTML = data.teams.map(teamColumn).join("");
}

const OVERLAY_ENTER_MS = 780;
const OVERLAY_EXIT_MS = 620;
let lastOverlayVisible = null;
let overlayAnimTimer = null;

function setOverlayVisibility(visible) {
  const el = $("overlay");
  if (overlayAnimTimer) {
    clearTimeout(overlayAnimTimer);
    overlayAnimTimer = null;
  }

  if (visible) {
    el.classList.remove("hidden", "is-exiting", "is-shown");
    el.classList.add("is-entering");
    void el.offsetWidth;
    overlayAnimTimer = window.setTimeout(() => {
      el.classList.remove("is-entering");
      el.classList.add("is-shown");
      overlayAnimTimer = null;
    }, OVERLAY_ENTER_MS);
    return;
  }

  el.classList.remove("hidden", "is-entering", "is-shown");
  el.classList.add("is-exiting");
  void el.offsetWidth;
  overlayAnimTimer = window.setTimeout(() => {
    el.classList.remove("is-exiting");
    el.classList.add("hidden");
    overlayAnimTimer = null;
  }, OVERLAY_EXIT_MS);
}

function render(data) {
  if (!data) return;

  const visible = data.visible !== false;
  const contentKey = JSON.stringify({
    matchId: data.matchId,
    day: data.day,
    matchNumber: data.matchNumber,
    round: data.round,
    category: data.category,
    teams: data.teams,
  });

  // Keep content on screen during hide so exit animation has something to animate.
  if (visible || lastOverlayVisible !== false) {
    if (contentKey !== lastContentKey) {
      lastContentKey = contentKey;
      applyOverlayContent(data);
    }
  }

  if (lastOverlayVisible === null) {
    lastOverlayVisible = visible;
    if (visible) {
      setOverlayVisibility(true);
    } else {
      $("overlay").classList.add("hidden");
    }
    return;
  }

  if (visible !== lastOverlayVisible) {
    lastOverlayVisible = visible;
    setOverlayVisibility(visible);
  }
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
let lastContentKey = "";
let lastTransitionState = null;
let transitionShown = false;
let transitionAnimating = false;
let pendingTransitionState = null;
let lastStartingSoonState = null;
let startingSoonShown = false;
let startingSoonAnimTimer = null;

function initSceneTransition() {
  const stage = document.querySelector(".scene-transition-stage");
  if (!stage) return;
  stage.innerHTML = SCENE_TRANSITION_BARS.map(
    (bar) =>
      `<div class="scene-bar scene-bar--${bar.origin} scene-bar--${bar.tone}" style="--h:${bar.height}%;--top:${bar.top}%;--enter-delay:${bar.enterDelay}s;--exit-delay:${bar.exitDelay}s;--enter-dur:${bar.enterDur}s;--exit-dur:${bar.exitDur}s"></div>`
  ).join("");
}

function setTransitionPhase(phase) {
  const el = $("scene-transition");
  el.className = "scene-transition";
  if (phase) el.classList.add(phase);
  // Force style recalc so exit animations start from the held pose, not a blank frame.
  void el.offsetWidth;
  el.setAttribute("aria-hidden", phase ? "false" : "true");
}

function finishTransitionAnimation() {
  transitionAnimating = false;
  if (pendingTransitionState == null) return;
  const next = pendingTransitionState;
  pendingTransitionState = null;
  if (next !== transitionShown) {
    updateSceneTransition(next);
  }
}

function updateSceneTransition(shouldShow) {
  if (transitionAnimating) {
    pendingTransitionState = shouldShow;
    return;
  }

  if (shouldShow && !transitionShown) {
    transitionAnimating = true;
    pendingTransitionState = null;
    setTransitionPhase("is-entering");
    window.setTimeout(() => {
      transitionShown = true;
      setTransitionPhase("is-shown");
      finishTransitionAnimation();
    }, SCENE_ENTER_MS);
    return;
  }

  if (!shouldShow && transitionShown) {
    transitionAnimating = true;
    pendingTransitionState = null;
    // Keep bars painted for one frame in the held pose, then start exit animations.
    setTransitionPhase("is-shown");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTransitionPhase("is-exiting");
        window.setTimeout(() => {
          transitionShown = false;
          setTransitionPhase(null);
          finishTransitionAnimation();
        }, SCENE_EXIT_MS);
      });
    });
  }
}

function updateStartingSoon(shouldShow) {
  const el = $("starting-soon");
  if (!el) return;

  if (startingSoonAnimTimer) {
    clearTimeout(startingSoonAnimTimer);
    startingSoonAnimTimer = null;
  }

  if (shouldShow && !startingSoonShown) {
    startingSoonShown = true;
    el.classList.remove("is-leaving");
    el.classList.add("is-active");
    el.setAttribute("aria-hidden", "false");
    return;
  }

  if (!shouldShow && startingSoonShown) {
    startingSoonShown = false;
    el.classList.remove("is-active");
    el.classList.add("is-leaving");
    el.setAttribute("aria-hidden", "true");
    startingSoonAnimTimer = window.setTimeout(() => {
      el.classList.remove("is-leaving");
      startingSoonAnimTimer = null;
    }, 560);
  }
}

async function tick() {
  const data = await fetchOverlay();
  if (!data) return;

  const serverTransition = data.sceneTransition === true;

  if (lastTransitionState === null) {
    lastTransitionState = serverTransition;
    if (serverTransition) {
      updateSceneTransition(true);
    }
  } else if (serverTransition !== lastTransitionState) {
    lastTransitionState = serverTransition;
    updateSceneTransition(serverTransition);
  }

  const serverStartingSoon = data.startingSoon === true;
  if (lastStartingSoonState === null) {
    lastStartingSoonState = serverStartingSoon;
    if (serverStartingSoon) updateStartingSoon(true);
  } else if (serverStartingSoon !== lastStartingSoonState) {
    lastStartingSoonState = serverStartingSoon;
    updateStartingSoon(serverStartingSoon);
  }

  const { sceneTransition: _sceneTransition, startingSoon: _startingSoon, ...content } = data;
  const json = JSON.stringify(content);
  if (json !== lastJson) {
    lastJson = json;
    render(data);
  }
}

initSceneTransition();
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
