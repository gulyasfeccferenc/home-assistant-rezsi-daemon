import { describe, expect, it } from 'vitest';
import { carryForward } from '../src/index.js';
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
    expect(y26.months.find((m) => m.month === 11)!.readings.electricity).toEqual({ value: 4000, date: '2026-11-10' });
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

  it('does nothing when nothing is lower', () => {
    const files = [year(2026, { 1: { water: 10 }, 3: { water: 12 } })];
    expect(carryForward(files, 2026, 1)).toEqual({ changed: [], adjustments: [] });
  });
});
