import { describe, expect, it } from 'vitest';
import {
  dailyConsumption,
  dailyGasFileSchema,
  dailyMeansFromHourly,
  dailyReminderSlot,
  temperatureRegression,
  weeklyIntensity,
  zonedToEpoch,
} from '../src/index.js';

const r = (at: string, value: number) => ({ at, value });

describe('zonedToEpoch', () => {
  it('converts Budapest local time, winter and summer', () => {
    expect(new Date(zonedToEpoch('2026-11-27T18:00')).toISOString()).toBe('2026-11-27T17:00:00.000Z');
    expect(new Date(zonedToEpoch('2026-07-01T18:00')).toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(new Date(zonedToEpoch('2026-11-27')).toISOString()).toBe('2026-11-26T23:00:00.000Z');
  });
});

describe('dailyConsumption', () => {
  it('splits by time: evening and next morning readings', () => {
    // 21:00 -> 07:00 next day: 10 m³ over 10 hours; 3 h belong to the 1st, 7 h to the 2nd.
    const { days } = dailyConsumption([r('2026-12-01T21:00', 100), r('2026-12-02T07:00', 110)]);
    expect(days.map((d) => [d.date, +d.consumption.toFixed(3), +d.coverage.toFixed(3), d.complete])).toEqual([
      ['2026-12-01', 3, 0.125, false],
      ['2026-12-02', 7, 0.292, false],
    ]);
  });

  it('makes a day complete once readings surround it, whatever the reading times', () => {
    const { days } = dailyConsumption([
      r('2026-12-01T18:00', 100), // evening
      r('2026-12-02T07:30', 106.75), // early next morning: 13.5 h at 0.5 m³/h
      r('2026-12-03T22:00', 125.0), // late evening: 38.5 h
    ]);
    const dec2 = days.find((d) => d.date === '2026-12-02')!;
    expect(dec2.complete).toBe(true);
    // 7.5 h at 0.5 + 16.5 h at 18.25/38.5
    expect(dec2.consumption).toBeCloseTo(7.5 * 0.5 + 16.5 * (18.25 / 38.5), 6);
    expect(days.find((d) => d.date === '2026-12-03')!.complete).toBe(false); // ends at 22:00
    // Total is preserved.
    expect(days.reduce((s, d) => s + d.consumption, 0)).toBeCloseTo(25, 9);
  });

  it('spreads a skipped day evenly and handles the DST change (23-hour day)', () => {
    const { days } = dailyConsumption([r('2026-03-28T00:00', 0), r('2026-03-30T00:00', 47)]);
    // 29 March 2026 has 23 hours in Budapest: 24 h + 23 h = 47 h at 1 m³/h.
    expect(days.map((d) => [d.date, +d.consumption.toFixed(6), d.complete])).toEqual([
      ['2026-03-28', 24, true],
      ['2026-03-29', 23, true],
    ]);
    expect(days[0].maxIntervalHours).toBe(47);
  });

  it('joins temperatures, computes degree days, reports decreasing readings', () => {
    const { days, problems } = dailyConsumption(
      [r('2026-12-01T00:00', 10), r('2026-12-02T00:00', 22), r('2026-12-03T00:00', 21)],
      { '2026-12-01': 2.5 },
      16,
    );
    expect(days[0]).toMatchObject({ date: '2026-12-01', consumption: 12, meanTemp: 2.5, hdd: 13.5, complete: true });
    expect(problems).toEqual([{ at: '2026-12-03T00:00', message: 'Kisebb, mint az előző leolvasás (22 → 21).' }]);
  });
});

describe('analysis', () => {
  const days = [
    { t: 5, c: 8 }, { t: 0, c: 13 }, { t: -5, c: 18 }, { t: 2, c: 11 }, { t: 8, c: 5 }, { t: 3, c: 10 },
  ].map(({ t, c }, i) => ({
    date: `2026-12-0${i + 1}`, consumption: c, coverage: 1, complete: true, maxIntervalHours: 24, meanTemp: t, hdd: Math.max(0, 16 - t),
  }));

  it('fits consumption against temperature', () => {
    const reg = temperatureRegression(days)!;
    expect(reg.slope).toBeCloseTo(-1, 9);
    expect(reg.intercept).toBeCloseTo(13, 9);
    expect(reg.r2).toBeCloseTo(1, 9);
    expect(temperatureRegression(days.slice(0, 4))).toBeUndefined();
    expect(temperatureRegression(days.map((d) => ({ ...d, complete: false })))).toBeUndefined();
  });

  it('sums weeks (Monday start) into m³ per degree day', () => {
    const w = weeklyIntensity(days);
    // 2026-12-01 is a Tuesday: 1–6 Dec are in the week of 30 Nov.
    expect(w).toHaveLength(1);
    expect(w[0].week).toBe('2026-11-30');
    expect(w[0].perHdd).toBeCloseTo(65 / (6 * 16 - 13), 9);
  });

  it('computes daily means only for finished days with all hours', () => {
    const time = [...Array(24)].map((_, h) => `2026-12-01T${String(h).padStart(2, '0')}:00`).concat(['2026-12-02T00:00']);
    const temps: number[] = [...Array(24)].map((_, h): number => (h < 12 ? 0 : 2)).concat([5]);
    expect(dailyMeansFromHourly(time, temps, '2026-12-02')).toEqual({ '2026-12-01': 1 });
    expect(dailyMeansFromHourly(time, temps, '2026-12-01')).toEqual({});
  });
});

describe('daily reminder', () => {
  const slots = ['18:00', '21:00'];
  const at = (hour: number, minute = 0) => ({ date: '2026-12-01', hour, minute });
  it('sends at 18:00 and repeats at 21:00 only while nothing is entered', () => {
    expect(dailyReminderSlot(at(17, 59), slots, false, undefined)).toBeUndefined();
    expect(dailyReminderSlot(at(18), slots, false, undefined)).toBe(0);
    expect(dailyReminderSlot(at(19), slots, false, { date: '2026-12-01', slot: 0 })).toBeUndefined();
    expect(dailyReminderSlot(at(21), slots, false, { date: '2026-12-01', slot: 0 })).toBe(1);
    expect(dailyReminderSlot(at(21), slots, true, { date: '2026-12-01', slot: 0 })).toBeUndefined();
    // Restart at 22:00 without any send today: only the latest slot goes out.
    expect(dailyReminderSlot(at(22), slots, false, { date: '2026-11-30', slot: 1 })).toBe(1);
    expect(dailyReminderSlot(at(22), ['18:00', ''], false, undefined)).toBe(0);
  });
});

describe('file schema', () => {
  it('validates and sorts readings', () => {
    const f = dailyGasFileSchema.parse({ schemaVersion: 1, readings: [r('2026-12-02T07:00', 2), r('2026-12-01T18:00', 1)] });
    expect(f.readings.map((x) => x.at)).toEqual(['2026-12-01T18:00', '2026-12-02T07:00']);
    expect(() => dailyGasFileSchema.parse({ schemaVersion: 1, readings: [r('2026-12-01T24:00', 1)] })).toThrow();
    expect(() => dailyGasFileSchema.parse({ schemaVersion: 1, readings: [r('2026-02-30T10:00', 1)] })).toThrow();
  });
});
