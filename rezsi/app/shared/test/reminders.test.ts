import { describe, expect, it } from 'vitest';
import { decideSend, DEFAULT_CALC_CONFIG, History, meterDue, reminderText, type CalcConfig } from '../src/index.js';
import { year } from './helpers.js';

const cfg = DEFAULT_CALC_CONFIG;

/** Simulates the daily job for a date range and returns the days a reminder went out. */
function simulate(history: History, meter: 'gas' | 'electricity' | 'water', from: string, to: string, c: CalcConfig = cfg) {
  const sent: string[] = [];
  let lastSent: string | undefined;
  for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const today = d.toISOString().slice(0, 10);
    const due = meterDue(history, meter, today, c);
    const decision = decideSend(due, today, lastSent, c);
    if (decision.send) {
      sent.push(today + (decision.urgent ? '!' : ''));
      lastSent = today;
    }
  }
  return sent;
}

describe('monthly windows', () => {
  it('sends on day one, every second day and urgently on the last day', () => {
    const h = new History([year(2026, {})]);
    expect(simulate(h, 'gas', '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-20', '2026-10-22', '2026-10-24', '2026-10-26', '2026-10-28!',
    ]);
    expect(simulate(h, 'electricity', '2026-10-01', '2026-10-31')).toEqual(['2026-10-08', '2026-10-10', '2026-10-11!']);
  });

  it('stops once the reading is entered', () => {
    const h = new History([year(2026, { 10: { electricity: 100 } })]);
    expect(simulate(h, 'electricity', '2026-10-01', '2026-10-31')).toEqual([]);
    const gasOnlyActual = new History([year(2026, { 10: { gas: 100 } })]);
    expect(simulate(gasOnlyActual, 'gas', '2026-10-20', '2026-10-20')).toEqual(['2026-10-20']);
  });

  it('clamps the window to short months', () => {
    const c = { ...cfg, gasWindow: { startDay: 25, endDay: 31 } };
    const h = new History([year(2026, {})]);
    const due = meterDue(h, 'gas', '2026-02-10', c);
    expect(due.windowStart).toBe('2026-02-25');
    expect(due.windowEnd).toBe('2026-02-28');
    expect(simulate(h, 'gas', '2026-02-01', '2026-03-01', c)).toEqual(['2026-02-25', '2026-02-27', '2026-02-28!']);
    expect(meterDue(new History([year(2028, {})]), 'gas', '2028-02-10', c).windowEnd).toBe('2028-02-29');
  });

  it('opens a fresh window at the month boundary', () => {
    const h = new History([year(2026, { 9: { gas: 1, reported: 1 } })]);
    expect(meterDue(h, 'gas', '2026-09-30', cfg).status).toBe('ok');
    expect(meterDue(h, 'gas', '2026-10-01', cfg).status).toBe('upcoming');
    expect(meterDue(h, 'gas', '2026-10-29', cfg).status).toBe('overdue');
  });

  it('does not resend on the same day after a restart', () => {
    const h = new History([year(2026, {})]);
    const due = meterDue(h, 'gas', '2026-10-20', cfg);
    expect(decideSend(due, '2026-10-20', undefined, cfg).send).toBe(true);
    expect(decideSend(due, '2026-10-20', '2026-10-20', cfg).send).toBe(false);
    // Restart on the 21st after sending on the 20th: not yet (repeat every 2 days).
    expect(decideSend(meterDue(h, 'gas', '2026-10-21', cfg), '2026-10-21', '2026-10-20', cfg).send).toBe(false);
  });

  it('catches up when the first day was missed', () => {
    const h = new History([year(2026, {})]);
    expect(decideSend(meterDue(h, 'gas', '2026-10-23', cfg), '2026-10-23', '2026-09-28', cfg).send).toBe(true);
  });
});

describe('water', () => {
  it('opens 60 days after the last reading, then keeps reminding while overdue', () => {
    const h = new History([year(2026, { 7: { water: 10, day: 1 } })]);
    expect(meterDue(h, 'water', '2026-08-29', cfg).status).toBe('ok');
    const due = meterDue(h, 'water', '2026-08-30', cfg);
    expect(due).toMatchObject({ status: 'due', windowStart: '2026-08-30', windowEnd: '2026-09-05' });
    expect(simulate(h, 'water', '2026-08-01', '2026-09-10')).toEqual([
      '2026-08-30', '2026-09-01', '2026-09-03', '2026-09-05!', '2026-09-07', '2026-09-09',
    ]);
  });

  it('is unknown without any reading', () => {
    expect(meterDue(new History([]), 'water', '2026-10-08', cfg).status).toBe('unknown');
  });
});

describe('texts', () => {
  it('includes the suggested value and deficit for gas', () => {
    const h = new History([
      year(2026, { 9: { gas: 7600, reported: 7462 }, 10: { gas: 7800 } }, { gasProfile: { 10: 150 } }),
    ]);
    const due = meterDue(h, 'gas', '2026-10-20', cfg);
    expect(reminderText(due, false).message).toBe(
      'Gáz diktálás: 10.20–10.28. Javasolt érték: 7 612 m³ Nem diktált: 338 m³',
    );
    expect(reminderText(meterDue(h, 'electricity', '2026-10-11', cfg), true).message).toBe(
      'Utolsó nap! Villanyóra leolvasás esedékes (10.08–10.11.)',
    );
  });
});
