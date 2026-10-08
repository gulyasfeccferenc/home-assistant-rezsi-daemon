# Rezsi

Household utility tracker (gas, electricity, water, telecom, waste collection) with a Hungarian UI in
the Home Assistant sidebar, push reminders for meter readings, and a monthly export to a private git
repository.

## Views

- **Áttekintés** – status of this month's readings, costs year to date vs last year, unpaid bills, warnings.
- **Rögzítés** – entry form per month: meter readings, reported gas reading (with the suggested value),
  bills with a paid toggle, note. Live checks while typing.
- **Táblázat** – the yearly sheet layout: readings and payable amounts per month, consumption, last year,
  gas profile. Italic values are estimated (spread over months without a reading).
- **Grafikonok** – consumption vs last year, cost per category, unit price trend, gas actual vs reported vs plan.
- **Beállítások** – gas profile and annual targets per year, tariffs, export status and "Exportálás most",
  "Teszt értesítés", the one-time xlsx import, and the (read-only) add-on options.

## Reminders

Checked every day at `reminder_time` (Europe/Budapest) and once at startup. A reminder is sent on the
first day of the meter's window, then every `repeat_every_days`, and on the last day marked urgent, until
the reading is entered. At most one notification per meter per day; sends are recorded in
`/data/state.json`, so a restart never resends.

| Meter | Window | Done when |
|---|---|---|
| Gas | `gas_window_start_day`–`gas_window_end_day` every month | actual **and** reported reading entered for the month |
| Electricity | `electricity_window_start_day`–`electricity_window_end_day` | reading entered for the month |
| Water | opens `water_interval_days` after the last reading, open for `water_window_days`, then overdue (reminders continue) | a newer reading is entered |

The gas reminder contains the suggested reported reading (previous reported reading + this month's
profile, capped by the actual reading) and the not-yet-reported amount.

Tapping a notification opens the add-on panel. The link points at the entry form of the month
(`/<addon slug>/rogzites/YYYY-MM`); if your Home Assistant version does not forward sub-paths of
Ingress panels, the panel opens on the overview, where due readings have a "Rögzítés" button.

With `publish_entities` enabled the add-on also sets `binary_sensor.rezsi_gas_due`,
`binary_sensor.rezsi_electricity_due`, `binary_sensor.rezsi_water_due`, `sensor.rezsi_month_total` and
`sensor.rezsi_unpaid_total`. They are re-published at startup and after every change (Home Assistant
does not persist states set through the API).

## Export to git

1. Create a **private** repository for the data, e.g. `rezsi-data` (it can be empty).
2. Create a **fine-grained personal access token** on GitHub with access to only that repository and
   the permission *Contents: Read and write*.
3. Set `git_repo_url` (HTTPS URL, e.g. `https://github.com/you/rezsi-data.git`), `git_token`, and
   `export_enabled: true`. Restart the add-on.

The export writes `data/<year>.json`, `csv/<year>.csv`, `xlsx/rezsi-<year>.xlsx` and
`reports/<year>-<month>.md`, commits only when something changed (`report: 2026-09` for the monthly run,
`export: manual 2026-10-08` for the button) and pushes. The token is passed to git as an HTTP header
through the environment: it is never written to disk or logged. If a push fails, the local commit is
kept, the error is shown in Beállítások, one notification is sent, and the next run retries. Without
`git_repo_url` the export only commits locally in `/data/export`.

## Import of the Google Sheet

Export the sheet as xlsx (File → Download → Microsoft Excel). In Beállítások choose the file, check the
preview (summary, warnings, and the differences between the sheet's derived rows and the recomputed
values), then import. Rows are matched by the label in column A; `Fa` is ignored. Existing year files
are backed up to `/data/backup/` first. Bills of months before the current one are imported as paid.

## Data

Everything lives in `/data` (included in Home Assistant backups):

```
/data/years/<year>.json   one file per year (validated, written atomically)
/data/settings.json       tariffs
/data/state.json          reminder and export state
/data/export/             local clone of the export repository
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `notify_service` | `mobile_app_ifecc` | notify service name without `notify.` |
| `reminder_time` | `09:00` | daily check time |
| `repeat_every_days` | `2` | repeat interval while a reading is due |
| `gas_window_start_day` / `gas_window_end_day` | `20` / `28` | gas reporting window |
| `electricity_window_start_day` / `electricity_window_end_day` | `8` / `11` | electricity window |
| `water_interval_days` / `water_window_days` | `60` / `7` | water window after the last reading |
| `yoy_warning_percent` | `15` | highlight consumption this much above last year |
| `publish_entities` | `true` | publish helper entities |
| `export_enabled` | `false` | monthly export |
| `export_day` / `export_time` | `1` / `06:00` | when the monthly export runs (a missed run is caught up at startup) |
| `git_repo_url` | – | HTTPS URL of the data repository |
| `git_token` | – | fine-grained access token |
| `git_branch` | `main` | branch to push |
| `git_author_name` / `git_author_email` | `Rezsi add-on` / `rezsi@localhost` | commit author |
