import { describe, expect, it } from 'vitest';
import { carryForward, DEFAULT_CALC_CONFIG, History, markCarriedDuplicates, meterDue } from '../src/index.js';
import { year } from './helpers.js';

describe('carryForward', () => {
  it('raises lower later readings to the saved value and keeps higher ones', () => {
    const files = [
      year(2026, { 10: { electricity: 4000 }, 11: { electricity: 3550, gas: 10 }, 12: { electricity: 4100 } }),
      year(2027, { 1: { electricity: 3900 } }),
    ];
    const { changed, adjustments } = carryForward(files, 2026, 10);
    expect(adjustments).toEqual([
      { year: 2026, month: 11, source: 'electricity', from: 3550, to: 4000 },
      { year: 2027, month: 1, source: 'electricity', from: 3900, to: 4000 },
    ]);
    const y26 = changed.find((f) => f.year === 2026)!;
    expect(y26.months.find((m) => m.month === 11)!.readings.electricity).toEqual({ value: 4000, date: '2026-11-10', carried: true });
    expect(y26.months.find((m) => m.month === 12)!.readings.electricity!.value).toBe(4100);
    expect(y26.months.find((m) => m.month === 11)!.readings.gas!.value).toBe(10); // other meters untouched
    // Inputs are not mutated.
    expect(files[0].months.find((m) => m.month === 11)!.readings.electricity!.value).toBe(3550);
  });

  it('handles the reported gas reading and ignores earlier months and empty months', () => {
    const files = [year(2026, { 8: { reported: 9000 }, 9: { reported: 7000 }, 10: {}, 11: { reported: 6990 } })];
    const { adjustments } = carryForward(files, 2026, 9);
    expect(adjustments).toEqual([{ year: 2026, month: 11, source: 'gasReported', from: 6990, to: 7000 }]);
  });

  it('carried values do not stop the next month reminder (regression)', () => {
    // October entered; November held an older placeholder that carry-forward raised.
    const files = [year(2026, { 10: { electricity: 4000, gas: 900, reported: 850 }, 11: { electricity: 3550, gas: 800, reported: 800 } })];
    const { changed } = carryForward(files, 2026, 10);
    const h = new History(changed);
    expect(meterDue(h, 'electricity', '2026-11-09', DEFAULT_CALC_CONFIG).status).toBe('due');
    expect(meterDue(h, 'gas', '2026-11-22', DEFAULT_CALC_CONFIG).status).toBe('due');
    // Placeholders are not readings: no consumption for November, latest reading is still October.
    expect(h.consumption('electricity', 2026, 11)).toBeUndefined();
    expect(h.latest('electricity')).toMatchObject({ month: 10, value: 4000 });
  });

  it('does not use a carried value as the base', () => {
    const files = [year(2026, { 10: { electricity: 4000 }, 11: { electricity: 3000 } })];
    files[0].months[0].readings.electricity!.carried = true;
    expect(carryForward(files, 2026, 10).adjustments).toEqual([]);
  });

  it('does nothing when nothing is lower', () => {
    const files = [year(2026, { 1: { water: 10 }, 3: { water: 12 } })];
    expect(carryForward(files, 2026, 1)).toEqual({ changed: [], adjustments: [] });
  });
});

describe('markCarriedDuplicates', () => {
  it('marks readings that repeat the previous one, across years, per meter', () => {
    const files = [
      year(2025, { 12: { electricity: 3550, water: 10 } }),
      year(2026, { 1: { electricity: 3550, water: 12 }, 2: { electricity: 3600, water: 12 }, 3: { electricity: 3600, reported: 5 } }),
    ];
    const { changed, marks } = markCarriedDuplicates(files);
    expect(marks.map((m) => `${m.year}-${m.month} ${m.source}`)).toEqual(['2026-1 electricity', '2026-2 water', '2026-3 electricity']);
    expect(changed.map((f) => f.year)).toEqual([2026]);
    expect(changed[0].months[0].readings.electricity).toEqual({ value: 3550, date: '2026-01-10', carried: true });
    expect(changed[0].months[1].readings.electricity!.carried).toBeUndefined();
    // Idempotent
    expect(markCarriedDuplicates([files[0], changed[0]]).marks).toEqual([]);
  });
});
