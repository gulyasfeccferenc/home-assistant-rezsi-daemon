# Rezsi — Home Assistant add-on (MVP specification)

> **For Claude Code:** this file is the source of truth for the MVP. Read it fully before writing code.
> Work milestone by milestone (section 17); each milestone ends in a working, installable add-on.
> Where this spec says *verify*, check the current Home Assistant developer docs
> (https://developers.home-assistant.io/docs/add-ons) instead of relying on memory.
> Open questions are collected in section 18. If one blocks you, ask; otherwise use the stated default.

---

## 1. Context and goals

The owner tracks household utility costs ("rezsi") for a property in Hungary in a Google Sheet,
one tab per year. Each month records meter readings, the payable amount per bill, derived consumption,
last year's consumption for comparison, and the gas consumption profile ("jelleggörbe").

The goal is to move this into a **Home Assistant add-on** that:

1. Appears as its own **sidebar tab** in Home Assistant (Ingress) and is reachable **only through HA**.
2. Lets the owner enter readings and bills manually (no meter sensors exist yet).
3. Sends **push reminders** to the owner's phone when a meter has to be read or reported.
4. **Exports** the data monthly (JSON/CSV/xlsx/Markdown report) and **commits it to a private GitHub repo**.
5. Is later able to pull consumption from HA sensors (not in the MVP).

Environment facts:

- Home Assistant OS (Supervisor available, add-ons and Ingress supported).
- Notifications: HA built-in `notify` with the companion app on an iPhone: service `notify.mobile_app_ifecc`.
- Time zone: `Europe/Budapest`.
- Owner is fluent in HTML/CSS/TypeScript. **UI language: Hungarian. Code, comments, commit messages: English.**

## 2. Domain glossary (Hungarian → meaning)

| Term | Meaning |
|---|---|
| Rezsi | Household utility costs |
| Óraállás | Meter reading (cumulative) |
| Fizetendő | Amount payable on the bill (HUF, "Ft") |
| Gáz | Natural gas (m³) |
| Gáz diktált / diktálandó | Gas reading **reported to the provider** (self-reading). Can differ from the actual reading, see 7.3 |
| Villany / Áram | Electricity (kWh). The owner reports this reading too |
| Víz | Water (m³), read roughly every two months |
| Telekom | Telecom/internet bill (fixed, amount only) |
| Szemétszállítás | Waste collection (amount only, irregular, e.g. quarterly) |
| Fa | Firewood: **dropped**, not part of the new app |
| Fogyasztás | Consumption (derived from reading differences) |
| Tavalyi | Last year's |
| Gázfogyasztási jelleggörbe | Monthly gas consumption profile. The owner reports gas so that billed consumption follows this profile, to stay within the regulated (reduced) price band instead of paying market price |
| Összesen | Total |

## 3. Scope

### In the MVP

- Ingress sidebar panel, Hungarian UI, mobile-friendly (primary use is the HA iOS app).
- Manual entry of meter readings, reported gas readings and bill amounts, with paid flags and notes.
- Month table that resembles the current sheet, plus derived consumption, year-over-year comparison and unit prices.
- Charts: consumption vs last year, cost per category, unit price trend.
- Gas plan: profile per year and a suggested reported reading per month (7.3).
- Data checks (readings going backwards, unusual jumps, unpaid bills, missing readings).
- Per-meter reminders with different schedules, sent via `notify.mobile_app_ifecc`.
- Monthly and on-demand export, committed and pushed to a private GitHub repo.
- One-time import of the existing 2025 and 2026 sheets.

### Not in the MVP (keep the design open for them)

- Import of consumption from HA sensors / long-term statistics (no sensors exist yet).
- Heating degree days / weather correlation.
- Reading a meter from a photo.
- Multiple properties.
- Adding categories at runtime. **Categories are fixed in code**; a new category means a new add-on version.

## 4. Architecture and tech stack

Single Node.js process inside the add-on container:

- **Backend:** TypeScript + **Hono** (with `@hono/node-server`). Serves the API and the built frontend.
- **Frontend:** **Vite + Preact** + TypeScript, built to static files. Charts: **uPlot** (or Chart.js if simpler). No CDN: everything bundled, the app must work offline.
- **Shared:** a `shared` package with domain types, **zod** schemas and the calculation functions (used by both server and client, and by tests).
- **Storage:** plain JSON files in `/data` (no database). Atomic writes (write temp file, then rename). Included automatically in HA backups.
- **Scheduler:** in-process (e.g. `croner`) with explicit time zone `Europe/Budapest`. Scheduler state persisted to `/data/state.json` so restarts never resend reminders.
- **xlsx:** `exceljs`.
- **Git:** `git` CLI installed in the image (see section 12).
- **Tests:** `vitest` for calculations, schemas, reminder logic and export output.
- Package manager: `pnpm` workspaces (or npm workspaces, pick one and stay consistent).

Why no database: about 12 records per year; files diff cleanly in git, are human-editable, and are backed up by HA.

## 5. Repository layout (suggested)

```
/
├─ repository.yaml            # makes the repo installable as an HA add-on repository
├─ SPEC.md                    # this file
├─ README.md
└─ rezsi/                     # the add-on
   ├─ config.yaml
   ├─ build.yaml              # base images per arch (verify current format)
   ├─ Dockerfile
   ├─ DOCS.md                 # shown in the HA add-on page
   ├─ CHANGELOG.md
   ├─ icon.png  logo.png
   ├─ translations/en.yaml    # labels for add-on options
   └─ app/
      ├─ package.json         # workspaces
      ├─ shared/              # types, zod schemas, calc functions
      ├─ server/              # Hono app, storage, scheduler, HA client, export, git
      ├─ web/                 # Vite + Preact UI
      └─ scripts/import-sheet.ts
```

## 6. Add-on packaging

`config.yaml` (sketch, verify keys against current docs):

```yaml
name: Rezsi
version: "0.1.0"
slug: rezsi
description: Household utility tracker with reminders and git export
url: https://github.com/<owner>/<repo>
arch: [aarch64, amd64]        # see open question 18.6
init: false
ingress: true
ingress_port: 8099
panel_icon: mdi:home-lightning-bolt
panel_title: Rezsi
homeassistant_api: true       # call notify, set states
hassio_api: true              # /addons/self/info for ingress URL
options: { ... }              # see section 13
schema:  { ... }
```

Requirements:

- **No exposed ports.** Listen on `0.0.0.0:8099` and reject requests not coming from the Ingress gateway (`172.30.32.2`, verify).
- **Ingress base path is dynamic.** All frontend asset and API URLs must be relative (`base: './'` in Vite, `fetch('api/...')` without a leading slash). Use hash routing or derive the base from `X-Ingress-Path`.
- HA API calls go to `http://supervisor/core/api/...` with `Authorization: Bearer ${SUPERVISOR_TOKEN}`.
- Dockerfile: multi-stage. Build stage with Node to build `web` and `server`; runtime stage on the official HA base image for the arch with `nodejs`, `git`, `openssh-client` (if deploy keys are used) installed via `apk`. Run `node server/dist/index.js` as the entrypoint.
- Graceful shutdown on SIGTERM (flush pending writes).
- Log to stdout in a readable format (shown in the add-on Log tab).

## 7. Data model

### 7.1 Fixed categories

```ts
type MeterId = 'gas' | 'electricity' | 'water';
type BillId  = 'gas' | 'electricity' | 'water' | 'telecom' | 'waste';

const METERS = {
  gas:         { label: 'Gáz',    unit: 'm³',  reported: true  },
  electricity: { label: 'Villany', unit: 'kWh', reported: false },
  water:       { label: 'Víz',    unit: 'm³',  reported: false },
};
const BILLS = {
  gas: 'Gáz', electricity: 'Villany', water: 'Víz', telecom: 'Telekom', waste: 'Szemétszállítás',
};
```

Keep a per-category display color (taken from the current sheet) in the same definition; used by the UI and the xlsx export:
gas = light grey, electricity = light yellow, telecom = light peach, water = grey-blue, waste = light red/pink, total = yellow.

### 7.2 Files in `/data`

```
/data/years/2026.json     # one file per calendar year
/data/settings.json       # tariffs, annual targets (if not in add-on options)
/data/state.json          # scheduler/reminder state, last export, last push
/data/export/             # local copy of the git repo used for export
```

Year file (zod-validated on read and write; reject invalid data with a clear error):

```ts
interface YearFile {
  schemaVersion: 1;
  year: number;
  gasProfile: MonthlyValues;   // planned gas m³ per month (jelleggörbe), see 7.3
  annualTargets?: { gas?: number; electricity?: number }; // see open question 18.2
  months: MonthRecord[];       // up to 12, month 1..12
}

type MonthlyValues = Partial<Record<1|2|3|4|5|6|7|8|9|10|11|12, number>>;

interface MonthRecord {
  month: number;                         // 1..12
  readings: Partial<Record<MeterId, Reading>>;
  gasReported?: Reading;                 // "Gáz diktált": value reported to the provider
  bills: Partial<Record<BillId, Bill>>;
  note?: string;
}

interface Reading { value: number; date: string /* YYYY-MM-DD */; }

interface Bill {
  amount: number;                        // HUF, integer
  paid: boolean;
  dueDate?: string;
  periodFrom?: string; periodTo?: string;// optional billing period
}
```

Tariffs (optional in MVP UI, but model them now):

```ts
interface Tariff { bill: BillId; validFrom: string; unitPrice?: number; fixedFee?: number; note?: string; }
```

### 7.3 Derived values (implement as pure functions in `shared`, fully unit-tested)

- **Consumption** for a meter in month *m* = reading(m) − previous available reading.
  If readings are missing in between (water is read every ~2 months), spread the difference evenly
  across the months since the last reading and mark those values as *estimated* in the UI.
- **Billed gas consumption** = gasReported(m) − previous gasReported.
- **Gas deficit** = actual gas reading − reported gas reading (how much consumed gas has not been reported yet).
- **Suggested gas report for month m** = previous reported reading + `gasProfile[m]`,
  but never above the actual reading and never below the previous reported reading.
  Show it on the entry form and in the gas reminder. Show a warning when the deficit is larger
  than what the remaining months' profile can absorb.
- **Year-over-year:** consumption vs the same month last year, absolute and %.
  Highlight > +15 % (red) and < 0 % (green); threshold configurable.
- **Unit price:** bill amount ÷ billed consumption (gas uses reported consumption). Show "–" when consumption is 0 or missing.
- **Totals:** per month (sum of bills), year to date, average per month, projected annual cost.
- **Checks:** reading lower than the previous one (error), jump > 3× the median of the previous months (warning),
  unpaid bills (with due date if known), missing reading for a meter whose reminder window has passed.

## 8. UI (Hungarian)

Mobile first (HA iOS app, ~390 px wide), also usable on desktop. Light and dark theme following the system.

Views (hash routes):

1. **Áttekintés** (overview): current month status per meter (entered / due / overdue), next deadlines,
   unpaid bills, year-to-date cost vs last year, warnings from the checks.
2. **Rögzítés** (entry form) for a selected month, default = current month:
   readings with date (default today), reported gas reading with the suggested value pre-filled,
   bill amounts with paid toggle, note. Inline validation with the checks above. Large touch targets, numeric keyboard.
3. **Táblázat** (table) per year: layout like the sheet (categories as rows, months as columns,
   reading + payable sub-columns, totals row, consumption rows, last-year rows, gas profile row),
   category colors, sticky first column, horizontal scroll on mobile.
4. **Grafikonok** (charts): monthly consumption this year vs last year per meter; cost per category per month (stacked bars);
   unit price trend; gas reported vs actual vs profile.
5. **Beállítások** (settings): read-only view of the add-on options; gas profile and annual targets per year;
   tariffs; export status (last run, last commit, errors) and an **"Exportálás most"** button; a **"Teszt értesítés"** button.

Number format: Hungarian (`1 234 567 Ft`, decimal comma), dates `YYYY.MM.DD.`.

## 9. REST API (served under the Ingress path)

```
GET    api/health
GET    api/years                       -> [2025, 2026]
GET    api/years/:year                 -> YearFile + computed values
PUT    api/years/:year/months/:month   -> upsert MonthRecord (validated)
PUT    api/years/:year/profile         -> gas profile + annual targets
GET    api/status                      -> reminder state, due items, warnings
GET/PUT api/tariffs
POST   api/export                      -> run export (+ git push) now
POST   api/notify/test                 -> send a test notification
POST   api/import                      -> upload the sheet export (one-time import, see 14)
```

## 10. Reminders

Different schedule per meter, configured in the add-on options (section 13). Defaults:

| Meter | Rule | Window | Satisfied when |
|---|---|---|---|
| Gas | monthly | day 20–28 | `gasReported` (and actual reading) exists for the current month |
| Electricity | monthly | day 8–11 | electricity reading exists for the current month |
| Water | every 2 months, relative to the last water reading | opens 60 days after the last reading, stays open 7 days, then overdue | a newer water reading exists |

Behaviour:

- Check once per day at the configured time (default `09:00`, Europe/Budapest), and once at startup (without resending).
- Send on the first day of the window, then every `repeat_every_days` (default 2) while not satisfied,
  and on the last day of the window marked as urgent. Stop as soon as the reading is entered.
- One notification per meter per day maximum; record every send in `state.json`.
- Gas notification includes the **suggested reported value** and the current deficit.
- Call: `POST http://supervisor/core/api/services/notify/<notify_service>` with
  `{ title, message, data: { url: <ingress panel path>#/rogzites?month=..., tag: 'rezsi-<meter>', group: 'rezsi' } }`.
  Get the panel path from `GET http://supervisor/addons/self/info` (`ingress_url` / slug). *Verify on the iPhone that tapping opens the add-on panel.*
- Example texts: `Gáz diktálás: 10.20–10.28. Javasolt érték: 7 612 m³` / `Villanyóra leolvasás esedékes (10.08–10.11.)` / `Vízóra leolvasás esedékes`.

Optional (milestone 7): publish entities via `POST /api/states/...`:
`binary_sensor.rezsi_gas_due`, `binary_sensor.rezsi_electricity_due`, `binary_sensor.rezsi_water_due`,
`sensor.rezsi_month_total` (HUF), `sensor.rezsi_unpaid_total` (HUF). Re-publish after restart (states set this way are not persistent).

## 11. Export

Runs monthly (default: 1st day of the month, 06:00) and on demand. Output into the export repo:

```
data/2026.json              # canonical data (copy of /data/years)
csv/2026.csv                # long format: year,month,category,kind,value,unit,date,paid
xlsx/rezsi-2026.xlsx        # sheet-like layout (see below)
reports/2026-09.md          # human-readable monthly report
```

- **Monthly report (Markdown):** readings, consumption, bills, paid status, YoY deltas, warnings. Renders nicely on GitHub.
- **xlsx:** one worksheet per year in the current sheet layout (rows = categories, two columns per month: reading / payable,
  totals, consumption, last year, gas profile), number formats with `Ft`, frozen first column.
  Category fill colors are **nice to have** (lower priority; do it if `exceljs` makes it cheap). Charts are not exported.
- Deterministic output (stable key order, no timestamps inside files) so git diffs show only real changes.

## 12. Git push

- Separate **private** data repository (see open question 18.5), configured by URL in the options.
- Auth (pick one, default A):
  - **A. Fine-grained personal access token** limited to the data repo with *Contents: read & write*; stored as a `password` option; push over HTTPS. Never log the token.
  - **B. Deploy key:** the add-on generates an ed25519 key in `/data/ssh/` on first start, shows the public key in Beállítások; push over SSH.
- Flow: clone or pull into `/data/export`, write files, `git add -A`, commit only if there are changes
  (`report: 2026-09` / `export: manual 2026-10-08`), push. Author name/email from options.
- On failure: keep the local commit, record the error in `state.json`, show it in the UI, send one notification. Retry on the next run.

## 13. Add-on options (`config.yaml` `options` / `schema`)

```yaml
options:
  notify_service: mobile_app_ifecc
  reminder_time: "09:00"
  repeat_every_days: 2
  gas_window_start_day: 20
  gas_window_end_day: 28
  electricity_window_start_day: 8
  electricity_window_end_day: 11
  water_interval_days: 60
  water_window_days: 7
  yoy_warning_percent: 15
  export_enabled: false
  export_day: 1
  export_time: "06:00"
  git_repo_url: ""
  git_token: ""
  git_author_name: "Rezsi add-on"
  git_author_email: "rezsi@localhost"
schema:
  notify_service: str
  reminder_time: match(^\d{2}:\d{2}$)
  repeat_every_days: int(1,7)
  gas_window_start_day: int(1,28)
  gas_window_end_day: int(1,31)
  electricity_window_start_day: int(1,28)
  electricity_window_end_day: int(1,31)
  water_interval_days: int(7,365)
  water_window_days: int(1,31)
  yoy_warning_percent: int(1,100)
  export_enabled: bool
  export_day: int(1,28)
  export_time: match(^\d{2}:\d{2}$)
  git_repo_url: str?
  git_token: password?
  git_author_name: str
  git_author_email: email
```

Read options from `/data/options.json` at startup. Provide English labels/descriptions in `translations/en.yaml`.

## 14. One-time import

- Source: the owner exports the Google Sheet ("2025 - Rezsi", "2026 - Rezsi" tabs) as **xlsx**.
- `scripts/import-sheet.ts` (CLI, run locally) and/or `POST api/import` (upload in Beállítások) parse it into year files.
- Mapping from the current sheet (2026 tab):
  - Row 1: month headers like `Április (2026.04.10.)` → month and reading date.
  - Row 2: sub-headers `Óraállás` / `Fizetendő` per month.
  - Rows: `Gáz` (reading + payable), `Gáz diktált/diktálandó` (reported reading), `Villany`, `Telekom`, `Víz`,
    `Szemétszállítás`, `Fa` (**ignore**), `Összesen`, `Fogyasztás` block (Áram, Gáz, Víz), `Tavalyi áram`, `Tavalyi gáz`,
    `Gázfogyasztási jelleggörbe` → `gasProfile`, `Gáz összesen` / `Áram összesen` (see 18.2).
  - Match rows **by label in column A**, not by row number (there are hidden/grouped rows, e.g. 12–15).
- Derived rows (consumption, last year, totals) are **not imported**; they are recomputed. The importer prints a report
  comparing recomputed values with the sheet values and lists mismatches for manual review.
- Do **not** commit the owner's xlsx or real data into the code repository.

## 15. Non-functional requirements

- Access only via HA Ingress; no own authentication needed.
- No outbound network calls except the HA Supervisor API and the configured git remote.
- Data survives add-on updates and is included in HA backups (`/data`).
- Schema version field and a migration hook for future changes.
- Small image and low memory use (target < 100 MB RAM).
- Accessibility basics: labels on inputs, sufficient contrast, keyboard usable on desktop.

## 16. Development workflow

- `pnpm dev`: Vite dev server + server in watch mode. Outside HA, the server uses `HA_URL` and a long-lived token
  (`HA_TOKEN`) instead of the Supervisor, and `DATA_DIR=./.data`. A `DRY_RUN_NOTIFY=1` mode logs notifications instead of sending.
- Seed script with realistic sample data (fictional values) for development.
- `pnpm test`: vitest. Must cover: consumption with missing months, suggested gas report, YoY, unit prices,
  checks, reminder windows (month boundaries, short months, restart without resend), CSV/Markdown export snapshots.
- CI (GitHub Actions): lint, typecheck, test, and build the add-on image for both architectures.
- Install for testing: either add the repo as an add-on repository in HA, or copy `rezsi/` to the `/addons` share (local add-on).

## 17. Milestones and acceptance criteria

1. **Skeleton:** add-on builds and installs on HA OS; "Rezsi" appears in the sidebar; Ingress page loads; `api/health` OK; assets load under the Ingress path.
2. **Data and entry:** year files with zod validation and atomic writes; entry form saves and reloads a month; table view shows the data like the sheet.
3. **Calculations and charts:** consumption, YoY, unit prices, totals, checks, gas plan with suggested report; charts render on the phone.
4. **Import:** 2025 and 2026 sheets imported; mismatch report reviewed; Fa ignored.
5. **Reminders:** per-meter windows from options; notification arrives on "ifecc"; tapping opens the entry form; no duplicates after restart; test button works.
6. **Export and git:** monthly job and manual button produce JSON/CSV/xlsx/Markdown; commit and push to the private repo; errors visible in the UI.
7. **Polish (optional):** xlsx colors, HA entities, tariff UI, DOCS.md and screenshots.

## 18. Open questions (defaults in brackets)

1. **"Összesen" row:** is it the monthly sum, a running total, or something else? The values (≈ 450–470 k Ft) are larger than the visible monthly bills. [Recompute as monthly sum of bills and show YTD separately; importer reports the difference.]
2. **"Gáz összesen 2 100" / "Áram összesen 2 250":** annual targets/limits for the year? [Treat as `annualTargets` per year.]
3. **Gas profile period:** does the profile follow the calendar year or the provider's settlement year, and where do the monthly values come from each year? [Calendar year, entered manually per year.]
4. **Reading date vs month:** the header date (e.g. `2026.04.10.`) is the reading date of that month's column? [Yes.]
5. **Data repo:** separate private repo for exports (recommended) or the same repo as the code? [Separate private repo.]
6. **Hardware architecture** of the HA machine (Raspberry Pi → aarch64, x86 mini PC → amd64)? [Build both.]
7. **Water:** is the water bill also bi-monthly, and is the reading reported to the provider? [Bill whenever it arrives; reading not reported.]
8. **Historical Fa costs** in 2025: drop completely or keep in the note field? [Drop.]
