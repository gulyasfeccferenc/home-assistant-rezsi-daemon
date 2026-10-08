import { describe, expect, it } from 'vitest';
import { optionsSchema, yearFileSchema } from '../src/index.js';
import { year } from './helpers.js';

describe('schemas', () => {
  it('accepts a valid year file and sorts months', () => {
    const f = year(2026, { 3: { gas: 10 }, 1: { gas: 5 } });
    const parsed = yearFileSchema.parse(f);
    expect(parsed.months.map((m) => m.month)).toEqual([1, 3]);
  });

  it('produces a stable key order regardless of input order', () => {
    const a = yearFileSchema.parse({
      months: [{ bills: {}, readings: { water: { date: '2026-01-02', value: 1 }, gas: { value: 2, date: '2026-01-02' } }, month: 1 }],
      gasProfile: { 2: 5, 1: 3 },
      year: 2026,
      schemaVersion: 1,
    });
    expect(JSON.stringify(a)).toBe(
      '{"schemaVersion":1,"year":2026,"gasProfile":{"1":3,"2":5},"months":[{"month":1,"readings":{"gas":{"value":2,"date":"2026-01-02"},"water":{"value":1,"date":"2026-01-02"}},"bills":{}}]}',
    );
  });

  it('rejects invalid data', () => {
    const base = year(2026, { 1: { gas: 1 } });
    expect(() => yearFileSchema.parse({ ...base, months: [...base.months, ...base.months] })).toThrow(/Duplikált/);
    expect(() => yearFileSchema.parse({ ...base, months: [{ month: 13, readings: {}, bills: {} }] })).toThrow();
    expect(() =>
      yearFileSchema.parse({ ...base, months: [{ month: 1, readings: { gas: { value: 1, date: '2026-02-30' } }, bills: {} }] }),
    ).toThrow(/dátum/);
    expect(() =>
      yearFileSchema.parse({ ...base, months: [{ month: 1, readings: {}, bills: { fa: { amount: 1, paid: true } } }] }),
    ).toThrow();
    expect(() =>
      yearFileSchema.parse({ ...base, months: [{ month: 1, readings: {}, bills: { gas: { amount: 1.5, paid: true } } }] }),
    ).toThrow();
  });

  it('fills option defaults', () => {
    const o = optionsSchema.parse({ notify_service: 'mobile_app_x' });
    expect(o.notify_service).toBe('mobile_app_x');
    expect(o.gas_window_start_day).toBe(20);
    expect(() => optionsSchema.parse({ reminder_time: '9:00' })).toThrow();
  });
});
