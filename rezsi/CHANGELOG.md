# Changelog

## 0.2.0

- The app is now called **RezsiDaemon** (sidebar, header, page title, notifications). The add-on slug stays `rezsi`, so existing data is kept.
- Dates are shown and entered as year.month.day (`2026.10.08.`) everywhere, including reminder windows and notifications. Date fields no longer depend on the device locale; the calendar button still opens the native picker.
- Warnings can be deleted one by one (✕). Deleted warnings stay hidden (also in exported reports) and can be restored in Beállítások.
- Saving a meter reading raises lower readings of the same meter in later months (also in later years) to the saved value; higher later readings are kept. The save message lists what changed.

## 0.1.0

- First version: Ingress panel (Hungarian UI), manual entry of readings and bills, sheet-like table,
  charts, gas plan with suggested reported reading, data checks, per-meter reminders via `notify`,
  monthly/manual export to a git repository, one-time import of the Google Sheet xlsx export.
