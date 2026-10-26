# Changelog

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
