# Rezsi – Home Assistant add-on

Household utility tracker for Home Assistant OS: a Hungarian Ingress panel for meter readings and bills,
push reminders when a meter has to be read or reported, and a monthly export (JSON/CSV/xlsx/Markdown)
committed to a private git repository. See [SPEC.md](SPEC.md) for the full specification and
[rezsi/DOCS.md](rezsi/DOCS.md) for user documentation.

## Install

- **As a repository:** Settings → Add-ons → Add-on store → ⋮ → Repositories → add
  `https://github.com/gulyasfeccferenc/home-assistant-rezsi-daemon`, then install **Rezsi**.
- **As a local add-on:** copy the `rezsi/` folder to the `/addons` share and reload the add-on store.

The image is built on the device from `rezsi/Dockerfile` (multi-stage: Node build, then
`ghcr.io/home-assistant/base` with `nodejs` and `git`).

## Development

Requirements: Node.js 22, pnpm 10.

```sh
cd rezsi/app
pnpm install
pnpm seed               # fictional sample data in ./.data
pnpm dev                # Vite on :5173 (proxies /api) + server on :8099 in watch mode
pnpm test               # vitest
pnpm typecheck && pnpm lint
pnpm build              # web/dist + server/dist/index.js (single bundled file)
```

Environment variables for the server outside Home Assistant:

| Variable | Meaning |
|---|---|
| `DATA_DIR` | data directory (default `./.data`, `/data` in the add-on) |
| `HA_URL`, `HA_TOKEN` | Home Assistant URL and a long-lived token (instead of the Supervisor) |
| `DRY_RUN_NOTIFY=1` | log notifications instead of sending them |
| `PORT` | listen port (default 8099) |
| `LOG_LEVEL` | `debug`, `info` (default), `warn`, `error` |

Importing the Google Sheet export locally:

```sh
pnpm import-sheet ~/Downloads/Rezsi.xlsx           # dry run with mismatch report
pnpm import-sheet ~/Downloads/Rezsi.xlsx --apply   # writes $DATA_DIR/years/*.json
```

Never commit the sheet export or real data to this repository (`*.xlsx` and `.data/` are ignored).

## Layout

```
repository.yaml          add-on repository manifest
rezsi/                   the add-on (config.yaml, Dockerfile, DOCS.md, translations, icons)
rezsi/app/shared         domain types, zod schemas, calculations, reminder logic (+ tests)
rezsi/app/server         Hono server: storage, API, scheduler, HA client, export, git, import (+ tests)
rezsi/app/web            Vite + Preact UI
rezsi/app/scripts        seed and import CLIs
```
