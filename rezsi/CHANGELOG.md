# Changelog

## 0.3.0

- New **Napi gáz** tab for daily gas meter readings (three decimals). The reading time is set
  automatically when saving and can be changed (e.g. a reading written down in the morning).
- Consumption between two readings is split onto calendar days in proportion to time, so morning and
  late-evening readings are both handled. A day is final once readings exist on both sides of it;
  partial days are shown lighter and left out of the analysis.
- Daily mean outdoor temperatures from **Open-Meteo** (free, no account) for the Home Assistant
  location (or `weather_latitude`/`weather_longitude`), cached in `/data/weather.json`.
- Analysis: daily consumption and temperature charts, consumption vs temperature with a trend line
  ("1 °C-kal hidegebb nap ≈ +X m³"), and weekly m³ per heating degree day
  (`heating_base_temperature`, default 16 °C).
- Daily reminder at `daily_gas_time` (18:00) and again at `daily_gas_repeat_time` (21:00), only if no
  reading was entered that day; tapping it opens the Napi gáz tab.
- The monthly entry form offers the daily reading closest to the monthly reading date for the gas
  meter (never filled in automatically).
- Daily readings are not part of the git export (they are in Home Assistant backups via `/data`).

## 0.2.1

- Fix: values carried over from an earlier month no longer count as that month's reading. Before, a
  November value raised by carry-forward (or copied in the original sheet) made November look
  "entered", so no reminder was sent. Such values are now stored as placeholders (`carried`):
  they do not stop reminders, are not used for consumption or checks, and appear in the entry form
  as "Még nincs leolvasva (átvitt érték: …)" with an empty field. Typing the real value (even the
  same number) makes it an actual reading.
- On first start, readings that repeat the previous reading of the same meter are marked as
  placeholders once (backups of the changed year files go to `/data/backup/`, each change is
  logged). The sheet import marks them the same way.
- Exports: placeholders are `carried` / `reported_carried` rows in the CSV, "(átvitt)" in the
  Markdown reports and italic in the xlsx.

## 0.2.0

- The app is now called **RezsiDaemon** (sidebar, header, page title, notifications). The add-on slug stays `rezsi`, so existing data is kept.
- Dates are shown and entered as year.month.day (`2026.10.08.`) everywhere, including reminder windows and notifications. Date fields no longer depend on the device locale; the calendar button still opens the native picker.
- Warnings can be deleted one by one (✕). Deleted warnings stay hidden (also in exported reports) and can be restored in Beállítások.
- Saving a meter reading raises lower readings of the same meter in later months (also in later years) to the saved value; higher later readings are kept. Before such a save a confirmation lists the months that would change (a guard against typos); the save message lists what changed.
- Charts on phones: a tap opens the tooltip, a second tap (or a tap outside the chart) closes it, and scrolling over a chart no longer opens one. Tooltips are smaller on phones.

## 0.1.0

- First version: Ingress panel (Hungarian UI), manual entry of readings and bills, sheet-like table,
  charts, gas plan with suggested reported reading, data checks, per-meter reminders via `notify`,
  monthly/manual export to a git repository, one-time import of the Google Sheet xlsx export.
