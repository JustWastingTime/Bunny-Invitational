# Bunny Invitational — OBS Overlay

Tournament overlay system for Umamusume 3v3v3 club matches. Team rosters and match data live in JSON files; a local server merges them and feeds a browser overlay for OBS.

## Operator Dashboard

Open **http://localhost:3456/dashboard** during the event.

From the dashboard you can:
- Select which match is live on OBS
- Switch category (Sprint / Mile / Medium / Long / Dirt)
- Hide/show overlay
- Mark **1st / 2nd / 3rd place players** for the active category (points roll up to teams)
- View live standings

Standings are saved to:
- `data/standings.json` (source of truth)
- `website/data/standings.json` (auto-synced for public site)

## Public scoreboard (GitHub Pages)

The `website/` folder is a static scoreboard that reads `website/data/standings.json`.

1. Run the dashboard during the event (it auto-updates standings files).
2. Run `npm run build:website` to refresh `website/data/public.json`, copy portraits into `website/assets/characters/`, and publish team rosters to `website/data/teams/`.
3. Commit and push `website/` to GitHub.
3. In repo settings, enable GitHub Pages from the `/website` folder (or move contents to `/docs` if you prefer).
4. Public URL will show standings (refreshes every 15s in browser).

For near-live public updates during stream night:
- commit + push `website/data/standings.json` between matches, or
- later automate with a GitHub Action/token (optional phase 2).

## Quick start

```bash
npm start
```

Open **http://localhost:3456/overlay** in OBS as a **Browser Source** (1920×1080, transparent background enabled).

## Organizer flow (simple)

1. Put all sprites in `assets/characters/` using numeric filenames, e.g. `1001.png`, `1043.webp`.
2. Fill each club file in `data/teams/` using `spriteId` numbers.
3. Build/edit one match file in `data/matches/`.
4. Set active match in `data/config.json`.
5. Run `npm run check` until it says `Data check passed`.
6. Start overlay with `npm start`, then use `http://localhost:3456/overlay` in OBS Browser Source.

During the event, only edit:
- `activeCategory` in the match file
- gate numbers (`races.<category>[].gate`)
- `data/config.json` when switching to the next match

After adding new sprite files to `assets/characters/`, restart the server (`npm start`) so the sprite map refreshes automatically.

Hide/show overlay quickly:
- `npm run overlay:hide` (hide UI)
- `npm run overlay:show` (show UI)
- `npm run overlay:toggle` (flip state)
- Optional keyboard: press `H` while the overlay page is focused

Switch race category quickly:
- Keyboard (overlay focused): `1` Sprint, `2` Mile, `3` Medium, `4` Long, `5` Dirt
- Terminal commands:
  - `npm run category:sprint`
  - `npm run category:mile`
  - `npm run category:medium`
  - `npm run category:long`
  - `npm run category:dirt`

## Project structure

```
data/
  config.json          ← which match is currently live
  courses.json         ← track + conditions per category (shared across all matches)
  teams/               ← one JSON per club (15 players × 5 categories)
  matches/             ← one JSON per 3v3v3 matchup (gates only)
  schema/              ← JSON schemas for validation
overlay/               ← OBS overlay (HTML/CSS/JS)
dashboard/             ← operator control panel
website/               ← public scoreboard for GitHub Pages
assets/
  characters/          ← sprites named by numeric spriteId (e.g. 1001.png)
  logo.svg             ← optional tournament logo (not used by current overlay)
server/                ← local HTTP server + merge API
scripts/
  new-match.js         ← scaffold a new match file
```

## Team JSON

Each team file (`data/teams/dust-bunny.json`) holds 15 members split across 5 categories (3 per category). Each member has a trainer name and full uma data for the future website:

```json
{ "trainer": "Player Name",
  "uma": {
    "name": "Biwa Hayahide",
    "spriteId": 1001,
    "rating": "SS",
    "style": "sashi",
    "stats": { "speed": 980, "stamina": 1200, "power": 900, "guts": 850, "wisdom": 900 },
    "skills": ["Late Surger Savvy ◎", "Long Straightaways ◎"]
  }
}
```

Copy `data/teams/_template.json` when adding a new club. `spriteId` must match digits in a file in `assets/characters/`, including names like `chara_stand_1001_100101.png`.

## Courses (`data/courses.json`)

Track and weather data is defined once per category — every match uses the same course for sprint, mile, etc. Edit this single file when venues are finalized:

```json
{ "conditions": { "season": "TBD", "weather": "Sunny", "ground": "Firm" },
  "categories": {
    "sprint": { "course": "Nakayama Racecourse", "surface": "Turf", "distance": 1200, "direction": "right" },
    "mile": { "course": "Tokyo Racecourse", "surface": "Turf", "distance": 1600, "direction": "left" }
  }
}
```

## Match JSON

Each match file only holds **who is racing** and **gate numbers** — no track data. Each category is a flat array of 9 entries (3 per team):

```json
{ "id": "day1-match01",
  "teams": ["uma-club-a", "uma-club-b", "boysmells-club"],
  "activeCategory": "long",
  "races": {
    "long": [
      { "teamId": "uma-club-a", "slot": 0, "gate": 6 },
      { "teamId": "uma-club-a", "slot": 1, "gate": 5 }
    ]
  }
}
```

**Live edits during broadcast:**

| Field | What to change |
|-------|----------------|
| `data/config.json` → `activeMatch` | Switch to a different match file |
| `activeCategory` | Switch sprint → mile → medium → long → dirt |
| `races.<category>[].gate` | Set gate numbers (1–9) when the draw is announced |
| `data/courses.json` | Update venue/conditions (rare — usually once before the event) |

Example gate edit:

```json
{ "teamId": "uma-club-a", "slot": 0, "gate": 6 }
```

Set `"gate": null` before the draw — the overlay shows a dashed placeholder.

## OBS setup

1. Run `npm start` on the stream PC.
2. In OBS: **Sources → + → Browser**.
3. URL: `http://localhost:3456/overlay`
4. Width: **1920**, Height: **1080**
5. Check **Shutdown source when not visible** (optional)
6. Check **Refresh browser when scene becomes active** (optional)
7. The overlay background is transparent — only the UI panels render.

The overlay polls every second, so saving a JSON file updates OBS within ~1s with no manual refresh.
Visibility state is also polled; hide/show commands apply in ~1s.

If OBS still shows old UI after code changes:
- right-click Browser Source → **Refresh**
- or tick **Refresh browser when scene becomes active**
- or add a cache buster once: `http://localhost:3456/overlay?v=2`

## Creating a new match

```bash
node scripts/new-match.js day1-match02 uma-club-a uma-club-b dust-bunny 1 2
```

Then set `data/config.json`:

```json
{ "activeMatch": "day1-match02" }
```

## Character portraits

Drop sprites into `assets/characters/` using numeric `spriteId` from team JSON:

```
assets/characters/1001.png
assets/characters/1002.webp
assets/characters/chara_stand_1001_100101.png
```

Missing images show a colored initial fallback.

## Why browser source instead of an OBS plugin?

A native OBS plugin (C++/Lua) is heavy to build and maintain. A browser source is what most tournament broadcasts use: easy to style, edit data without recompiling, and preview in any browser. This setup is production-ready for a 300-player invitational.

## Next steps (future website)

The team JSON already includes rating, stats, and skills — the same `data/teams/` files can power a results/bracket website. The `/api/overlay` endpoint shows the merge pattern; a future site can add `/api/teams/:id` and `/api/matches/:id` similarly.
