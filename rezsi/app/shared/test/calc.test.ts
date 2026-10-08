import { describe, expect, it } from 'vitest';
import { computeYear, DEFAULT_CALC_CONFIG, History, suggestGasReport, yoy } from '../src/index.js';
import { year } from './helpers.js';

const cfg = DEFAULT_CALC_CONFIG;

describe('consumption', () => {
  it('uses the difference to the previous reading, across year boundaries', () => {
    const h = new History([year(2025, { 12: { electricity: 1000 } }), year(2026, { 1: { electricity: 1250 }, 2: { electricity: 1450 } })]);
    expect(h.consumption('electricity', 2026, 1)).toEqual({ value: 250, estimated: false });
    expect(h.consumption('electricity', 2026, 2)).toEqual({ value: 200, estimated: false });
    expect(h.consumption('electricity', 2025, 12)).toBeUndefined();
  });

  it('spreads the difference over months without a reading and marks them estimated', () => {
    const h = new History([year(2026, { 1: { water: 100 }, 3: { water: 110 }, 6: { water: 125 } })]);
    expect(h.consumption('water', 2026, 2)).toEqual({ value: 5, estimated: true });
    expect(h.consumption('water', 2026, 3)).toEqual({ value: 5, estimated: true });
    expect(h.consumption('water', 2026, 4)).toEqual({ value: 5, estimated: true });
    expect(h.consumption('water', 2026, 6)).toEqual({ value: 5, estimated: true });
    expect(h.consumption('water', 2026, 7)).toBeUndefined();
  });

  it('computes billed gas from reported readings', () => {
    const h = new History([year(2026, { 1: { gas: 1000, reported: 950 }, 2: { gas: 1300, reported: 1200 } })]);
    const c = computeYear(h, 2026, cfg, '2026-03-01');
    expect(c.months[1].billedGas).toEqual({ value: 250, estimated: false });
    expect(c.months[1].consumption.gas?.value).toBe(300);
    expect(c.months[1].gasDeficit).toBe(100);
  });
});

describe('suggested gas report', () => {
  const profile = { gasProfile: { 9: 50, 10: 150, 11: 250, 12: 300 } };

  it('is the previous report plus the profile', () => {
    const h = new History([year(2026, { 9: { gas: 7600, reported: 7462 }, 10: { gas: 7800 } }, profile)]);
    const s = suggestGasReport(h, 2026, 10)!;
    expect(s.value).toBe(7612);
    expect(s.cappedByActual).toBe(false);
    expect(s.deficitAfter).toBe(188);
    expect(s.remainingProfile).toBe(550);
    expect(s.deficitWarning).toBe(false);
  });

  it('never exceeds the actual reading', () => {
    const h = new History([year(2026, { 9: { gas: 7470, reported: 7462 }, 10: { gas: 7500 } }, profile)]);
    const s = suggestGasReport(h, 2026, 10)!;
    expect(s.value).toBe(7500);
    expect(s.cappedByActual).toBe(true);
  });

  it('never goes below the previous report', () => {
    // Actual reading lower than the previous report (data error) must not lower the suggestion.
    const h = new History([year(2026, { 9: { gas: 7470, reported: 7462 }, 10: { gas: 7400 } }, profile)]);
    expect(suggestGasReport(h, 2026, 10)!.value).toBe(7462);
  });

  it('uses the latest actual reading when the month has none yet', () => {
    const h = new History([year(2026, { 9: { gas: 7480, reported: 7462 } }, profile)]);
    expect(suggestGasReport(h, 2026, 10)!.value).toBe(7480);
  });

  it('warns when the deficit cannot be absorbed', () => {
    const h = new History([year(2026, { 11: { gas: 9000, reported: 7000 }, 12: { gas: 9500 } }, profile)]);
    const s = suggestGasReport(h, 2026, 12)!;
    expect(s.value).toBe(7300);
    expect(s.deficitWarning).toBe(true);
  });

  it('works across year boundaries and returns undefined without data', () => {
    const h = new History([year(2025, { 12: { reported: 5000 } }), year(2026, { 1: { gas: 5600 } }, { gasProfile: { 1: 400 } })]);
    expect(suggestGasReport(h, 2026, 1)!.value).toBe(5400);
    expect(suggestGasReport(h, 2025, 12)).toBeUndefined();
  });
});

describe('year over year', () => {
  it('classifies changes', () => {
    expect(yoy(120, 100, 15)).toMatchObject({ delta: 20, percent: 20, status: 'warn' });
    expect(yoy(110, 100, 15)).toMatchObject({ status: 'neutral' });
    expect(yoy(90, 100, 15)).toMatchObject({ percent: -10, status: 'good' });
    expect(yoy(10, 0, 15)).toMatchObject({ percent: undefined, status: 'neutral' });
    expect(yoy(undefined, 100, 15)).toBeUndefined();
  });

  it('compares with the same month last year', () => {
    const h = new History([
      year(2025, { 1: { electricity: 0 }, 2: { electricity: 200 } }),
      year(2026, { 1: { electricity: 1000 }, 2: { electricity: 1250 } }),
    ]);
    const c = computeYear(h, 2026, cfg, '2026-03-01');
    expect(c.months[1].yoy.electricity).toMatchObject({ current: 250, previous: 200, percent: 25, status: 'warn' });
  });
});

describe('unit prices and totals', () => {
  const h = new History([
    year(2025, { 1: { bills: { telecom: 9000 } }, 2: { bills: { telecom: 9000 } } }),
    year(2026, {
      1: { gas: 1000, reported: 1000, electricity: 500, bills: { telecom: 10000 } },
      2: {
        gas: 1300,
        reported: 1200,
        electricity: 700,
        bills: { gas: 40000, electricity: 14000, telecom: 10000, waste: { amount: 6000, paid: false } },
      },
      3: { gas: 1300, reported: 1200, bills: { gas: 5000 } },
    }),
  ]);
  const c = computeYear(h, 2026, cfg, '2026-03-15');

  it('divides by billed consumption (gas: reported)', () => {
    expect(c.months[1].unitPrice.gas).toBe(200);
    expect(c.months[1].unitPrice.electricity).toBe(70);
    expect(c.months[2].unitPrice.gas).toBeUndefined(); // zero consumption
    expect(c.months[0].unitPrice.gas).toBeUndefined(); // no previous reading
  });

  it('sums bills', () => {
    expect(c.months[0].total).toBe(10000);
    expect(c.months[1].total).toBe(70000);
    expect(c.months[3].total).toBeUndefined();
    expect(c.totals.ytd).toBe(85000);
    expect(c.totals.lastYearYtd).toBe(18000);
    expect(c.totals.monthsElapsed).toBe(3);
    expect(c.totals.averagePerMonth).toBeCloseTo(28333.33, 1);
    expect(c.totals.projectedAnnual).toBeCloseTo(340000, 0);
    expect(c.totals.unpaidTotal).toBe(6000);
  });
});

describe('checks', () => {
  it('flags decreasing readings as errors', () => {
    const h = new History([year(2026, { 1: { electricity: 500 }, 2: { electricity: 400 } })]);
    const checks = computeYear(h, 2026, cfg, '2026-02-15').checks;
    expect(checks.filter((c) => c.code === 'reading_decreased')).toHaveLength(1);
    expect(checks[0]).toMatchObject({ level: 'error', month: 2, category: 'electricity' });
  });

  it('flags unusual jumps against the median of previous months', () => {
    const h = new History([
      year(2026, { 1: { electricity: 0 }, 2: { electricity: 100 }, 3: { electricity: 210 }, 4: { electricity: 300 }, 5: { electricity: 700 } }),
    ]);
    const checks = computeYear(h, 2026, cfg, '2026-05-09').checks.filter((c) => c.code === 'consumption_jump');
    expect(checks).toHaveLength(1);
    expect(checks[0].month).toBe(5);
  });

  it('does not flag jumps with too little history', () => {
    const h = new History([year(2026, { 1: { electricity: 0 }, 2: { electricity: 100 }, 3: { electricity: 1000 } })]);
    expect(computeYear(h, 2026, cfg, '2026-03-09').checks.some((c) => c.code === 'consumption_jump')).toBe(false);
  });

  it('reports unpaid and overdue bills', () => {
    const h = new History([
      year(2026, { 1: { bills: { gas: { amount: 1, paid: false, dueDate: '2026-02-01' }, telecom: { amount: 1, paid: false } } } }),
    ]);
    const checks = computeYear(h, 2026, cfg, '2026-02-10').checks;
    expect(checks.find((c) => c.category === 'gas')?.code).toBe('bill_overdue');
    expect(checks.find((c) => c.category === 'telecom')?.code).toBe('bill_unpaid');
  });

  it('reports missing readings once the window has passed', () => {
    const h = new History([year(2026, { 8: { electricity: 100, gas: 10, reported: 10 }, 10: { electricity: 300 } })]);
    const missing = computeYear(h, 2026, cfg, '2026-10-12').checks.filter((c) => c.code === 'reading_missing');
    // Electricity: September is missing (window 09.08–09.11 passed); October is present.
    expect(missing.filter((c) => c.category === 'electricity').map((c) => c.month)).toEqual([9]);
    // Gas: September window passed; October's (10.20–10.28) not yet.
    expect(missing.filter((c) => c.category === 'gas').map((c) => c.month)).toEqual([9]);
    expect(missing.filter((c) => c.category === 'gasReported').map((c) => c.month)).toEqual([9]);
  });

  it('reports overdue water readings', () => {
    const h = new History([year(2026, { 7: { water: 10, day: 1 } })]);
    const late = (asOf: string) => computeYear(h, 2026, cfg, asOf).checks.some((c) => c.category === 'water');
    expect(late('2026-09-05')).toBe(false); // window 08.30–09.05
    expect(late('2026-09-06')).toBe(true);
  });
});
