import { BILLS, BILL_IDS, METERS, METER_IDS, MONTHS, monthName, type BillId, type MeterId, type Month } from './categories.js';
import type { CalcConfig } from './config.js';
import { addDays, daysInMonth, fromMonthIndex, isoDate, monthIndex, parseIsoDate } from './dates.js';
import { formatDate, formatQuantity } from './format.js';
import type { Bill, MonthRecord, Reading, YearFile } from './schema.js';

export interface SeriesPoint {
  value: number;
  /** True when the value was spread evenly over months without a reading. */
  estimated: boolean;
}

export type ReadingSource = MeterId | 'gasReported';

interface TimelineEntry {
  index: number;
  year: number;
  month: number;
  value: number;
  date: string;
}

/**
 * Indexed view over all year files. Everything that crosses year boundaries
 * (previous readings, consumption spreading, last-year comparison) goes through here.
 */
export class History {
  readonly files: Map<number, YearFile>;
  private readonly timelines = new Map<ReadingSource, TimelineEntry[]>();
  private readonly consumptionCache = new Map<ReadingSource, Map<number, SeriesPoint>>();

  constructor(files: Iterable<YearFile>) {
    this.files = new Map([...files].map((f) => [f.year, f]));
  }

  years(): number[] {
    return [...this.files.keys()].sort((a, b) => a - b);
  }

  record(year: number, month: number): MonthRecord | undefined {
    return this.files.get(year)?.months.find((m) => m.month === month);
  }

  reading(source: ReadingSource, year: number, month: number): Reading | undefined {
    const rec = this.record(year, month);
    if (!rec) return undefined;
    return source === 'gasReported' ? rec.gasReported : rec.readings[source];
  }

  bill(year: number, month: number, id: BillId): Bill | undefined {
    return this.record(year, month)?.bills[id];
  }

  timeline(source: ReadingSource): TimelineEntry[] {
    let t = this.timelines.get(source);
    if (!t) {
      t = [];
      for (const year of this.years()) {
        for (const rec of this.files.get(year)!.months) {
          const r = source === 'gasReported' ? rec.gasReported : rec.readings[source];
          if (r) t.push({ index: monthIndex(year, rec.month), year, month: rec.month, value: r.value, date: r.date });
        }
      }
      t.sort((a, b) => a.index - b.index);
      this.timelines.set(source, t);
    }
    return t;
  }

  /** Latest reading strictly before the given month. */
  previous(source: ReadingSource, year: number, month: number): TimelineEntry | undefined {
    const idx = monthIndex(year, month);
    const t = this.timeline(source);
    for (let i = t.length - 1; i >= 0; i--) if (t[i].index < idx) return t[i];
    return undefined;
  }

  /** Latest reading in or before the given month. */
  latestUpTo(source: ReadingSource, year: number, month: number): TimelineEntry | undefined {
    // monthIndex(year, 13) is January of the next year, so this also works for December.
    return this.previous(source, year, month + 1);
  }

  latest(source: ReadingSource): TimelineEntry | undefined {
    const t = this.timeline(source);
    return t[t.length - 1];
  }

  /**
   * Consumption per month. The difference between two consecutive readings is assigned
   * to the month of the later reading; if months are missing in between, it is spread
   * evenly over all months since the previous reading and flagged as estimated.
   */
  consumptionMap(source: ReadingSource): Map<number, SeriesPoint> {
    let map = this.consumptionCache.get(source);
    if (!map) {
      map = new Map();
      const t = this.timeline(source);
      for (let i = 1; i < t.length; i++) {
        const prev = t[i - 1];
        const cur = t[i];
        const span = cur.index - prev.index;
        const diff = cur.value - prev.value;
        for (let k = prev.index + 1; k <= cur.index; k++) {
          map.set(k, { value: diff / span, estimated: span > 1 });
        }
      }
      this.consumptionCache.set(source, map);
    }
    return map;
  }

  consumption(source: ReadingSource, year: number, month: number): SeriesPoint | undefined {
    return this.consumptionMap(source).get(monthIndex(year, month));
  }
}

export interface YoY {
  current: number;
  previous: number;
  delta: number;
  /** Undefined when last year's value is 0. */
  percent?: number;
  status: 'warn' | 'good' | 'neutral';
}

export function yoy(current: number | undefined, previous: number | undefined, warnPercent: number): YoY | undefined {
  if (current === undefined || previous === undefined) return undefined;
  const delta = current - previous;
  const percent = previous > 0 ? (delta / previous) * 100 : undefined;
  let status: YoY['status'] = 'neutral';
  if (percent !== undefined) {
    if (percent > warnPercent) status = 'warn';
    else if (percent < 0) status = 'good';
  }
  return { current, previous, delta, percent, status };
}

export interface GasSuggestion {
  value: number;
  previousReported: number;
  profile: number;
  /** Latest known actual reading up to this month, if any. */
  actual?: number;
  cappedByActual: boolean;
  /** Actual minus suggested: consumed gas not yet reported after this report. */
  deficitAfter?: number;
  /** Sum of the profile for the rest of the year after this month. */
  remainingProfile: number;
  /** True when the deficit is larger than what the remaining months' profile can absorb. */
  deficitWarning: boolean;
}

/**
 * Suggested reported gas reading for a month: previous reported reading plus the month's
 * profile value, never above the actual reading and never below the previous report.
 */
export function suggestGasReport(history: History, year: number, month: number): GasSuggestion | undefined {
  const prev = history.previous('gasReported', year, month);
  if (!prev) return undefined;
  const file = history.files.get(year);
  const profile = file?.gasProfile[month as Month];
  if (profile === undefined) return undefined;
  const actual = history.latestUpTo('gas', year, month)?.value;

  let value = Math.round(prev.value + profile);
  let cappedByActual = false;
  if (actual !== undefined && value > actual) {
    value = Math.floor(actual);
    cappedByActual = true;
  }
  if (value < prev.value) value = prev.value;

  let remainingProfile = 0;
  for (let m = month + 1; m <= 12; m++) remainingProfile += file?.gasProfile[m as Month] ?? 0;
  const deficitAfter = actual !== undefined ? actual - value : undefined;
  return {
    value,
    previousReported: prev.value,
    profile,
    actual,
    cappedByActual,
    deficitAfter,
    remainingProfile,
    deficitWarning: deficitAfter !== undefined && deficitAfter > remainingProfile,
  };
}

export type CheckLevel = 'error' | 'warning' | 'info';

export interface Check {
  level: CheckLevel;
  code:
    | 'reading_decreased'
    | 'reported_decreased'
    | 'reported_above_actual'
    | 'consumption_jump'
    | 'bill_unpaid'
    | 'bill_overdue'
    | 'reading_missing'
    | 'gas_deficit';
  year: number;
  month: number;
  category?: MeterId | BillId | 'gasReported';
  message: string;
}

export interface ComputedMonth {
  month: number;
  consumption: Partial<Record<MeterId, SeriesPoint>>;
  /** Gas consumption as reported to the provider (difference of reported readings). */
  billedGas?: SeriesPoint;
  lastYearConsumption: Partial<Record<MeterId, SeriesPoint>>;
  yoy: Partial<Record<MeterId, YoY>>;
  /** Actual gas reading minus reported gas reading (both in this month). */
  gasDeficit?: number;
  gasSuggestion?: GasSuggestion;
  unitPrice: Partial<Record<BillId, number>>;
  total?: number;
  lastYearTotal?: number;
}

export interface YearTotals {
  ytd: number;
  lastYearYtd?: number;
  monthsElapsed: number;
  averagePerMonth?: number;
  projectedAnnual?: number;
  unpaidTotal: number;
  byBill: Partial<Record<BillId, number>>;
  consumption: Partial<Record<MeterId, number>>;
  billedGas: number;
  gasProfileTotal: number;
}

export interface ComputedYear {
  year: number;
  asOf: string;
  months: ComputedMonth[];
  totals: YearTotals;
  checks: Check[];
}

function sumBills(rec: MonthRecord | undefined): number | undefined {
  if (!rec) return undefined;
  const amounts = BILL_IDS.map((id) => rec.bills[id]?.amount).filter((a): a is number => a !== undefined);
  return amounts.length ? amounts.reduce((a, b) => a + b, 0) : undefined;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Last day of the monthly window, clamped to the month's length. */
export function monthlyWindow(year: number, month: number, w: { startDay: number; endDay: number }) {
  const dim = daysInMonth(year, month);
  const start = isoDate(year, month, Math.min(w.startDay, dim));
  const end = isoDate(year, month, Math.min(Math.max(w.endDay, w.startDay), dim));
  return { start, end };
}

export function computeYear(history: History, year: number, cfg: CalcConfig, asOf: string): ComputedYear {
  const asOfParts = parseIsoDate(asOf);
  const file = history.files.get(year);
  const months: ComputedMonth[] = [];
  const checks: Check[] = [];

  for (const month of MONTHS) {
    const rec = history.record(year, month);
    const consumption: ComputedMonth['consumption'] = {};
    const lastYearConsumption: ComputedMonth['lastYearConsumption'] = {};
    const yoyMap: ComputedMonth['yoy'] = {};
    for (const meter of METER_IDS) {
      const c = history.consumption(meter, year, month);
      if (c) consumption[meter] = c;
      const ly = history.consumption(meter, year - 1, month);
      if (ly) lastYearConsumption[meter] = ly;
      const y = yoy(c?.value, ly?.value, cfg.yoyWarningPercent);
      if (y) yoyMap[meter] = y;
    }
    const billedGas = history.consumption('gasReported', year, month);
    const actualGas = rec?.readings.gas?.value;
    const reportedGas = rec?.gasReported?.value;

    const unitPrice: ComputedMonth['unitPrice'] = {};
    for (const meter of METER_IDS) {
      const amount = rec?.bills[meter]?.amount;
      const qty = meter === 'gas' ? billedGas?.value : consumption[meter]?.value;
      if (amount !== undefined && qty !== undefined && qty > 0) unitPrice[meter] = amount / qty;
    }

    months.push({
      month,
      consumption,
      billedGas,
      lastYearConsumption,
      yoy: yoyMap,
      gasDeficit: actualGas !== undefined && reportedGas !== undefined ? actualGas - reportedGas : undefined,
      gasSuggestion: suggestGasReport(history, year, month),
      unitPrice,
      total: sumBills(rec),
      lastYearTotal: sumBills(history.record(year - 1, month)),
    });
  }

  checks.push(...computeChecks(history, year, cfg, asOf));

  // Totals
  const monthsElapsed = year < asOfParts.year ? 12 : year === asOfParts.year ? asOfParts.month : 0;
  let ytd = 0;
  let lastYearYtd = 0;
  let hasLastYear = false;
  let unpaidTotal = 0;
  const byBill: YearTotals['byBill'] = {};
  const consumptionTotals: YearTotals['consumption'] = {};
  let billedGasTotal = 0;
  for (const cm of months) {
    if (cm.month <= monthsElapsed) {
      ytd += cm.total ?? 0;
      if (cm.lastYearTotal !== undefined) {
        lastYearYtd += cm.lastYearTotal;
        hasLastYear = true;
      }
    }
    const rec = history.record(year, cm.month);
    for (const id of BILL_IDS) {
      const b = rec?.bills[id];
      if (!b) continue;
      byBill[id] = (byBill[id] ?? 0) + b.amount;
      if (!b.paid) unpaidTotal += b.amount;
    }
    for (const meter of METER_IDS) {
      const c = cm.consumption[meter];
      if (c) consumptionTotals[meter] = (consumptionTotals[meter] ?? 0) + c.value;
    }
    billedGasTotal += cm.billedGas?.value ?? 0;
  }
  const averagePerMonth = monthsElapsed > 0 ? ytd / monthsElapsed : undefined;
  const gasProfileTotal = MONTHS.reduce((s, m) => s + (file?.gasProfile[m] ?? 0), 0);

  return {
    year,
    asOf,
    months,
    totals: {
      ytd,
      lastYearYtd: hasLastYear ? lastYearYtd : undefined,
      monthsElapsed,
      averagePerMonth,
      projectedAnnual: averagePerMonth !== undefined ? averagePerMonth * 12 : undefined,
      unpaidTotal,
      byBill,
      consumption: consumptionTotals,
      billedGas: billedGasTotal,
      gasProfileTotal,
    },
    checks,
  };
}

const READING_LABEL: Record<ReadingSource, string> = {
  gas: 'Gázóra-állás',
  electricity: 'Villanyóra-állás',
  water: 'Vízóra-állás',
  gasReported: 'Diktált gázóra-állás',
};

function ym(year: number, month: number): string {
  return `${year}. ${monthName(month, false)}`;
}

export function computeChecks(history: History, year: number, cfg: CalcConfig, asOf: string): Check[] {
  const checks: Check[] = [];
  const asOfParts = parseIsoDate(asOf);
  const asOfIndex = monthIndex(asOfParts.year, asOfParts.month);

  for (const source of [...METER_IDS, 'gasReported'] as ReadingSource[]) {
    const t = history.timeline(source);
    const consumption = history.consumptionMap(source);
    for (let i = 0; i < t.length; i++) {
      const cur = t[i];
      if (cur.year !== year) continue;
      const prev = t[i - 1];
      if (prev && cur.value < prev.value) {
        checks.push({
          level: 'error',
          code: source === 'gasReported' ? 'reported_decreased' : 'reading_decreased',
          year,
          month: cur.month,
          category: source,
          message: `${READING_LABEL[source]} kisebb, mint az előző (${ym(prev.year, prev.month)}: ${prev.value} → ${cur.value}).`,
        });
      }
      if (source === 'gasReported') continue;
      // Jump detection compares actual monthly consumption against the median of earlier months.
      const c = consumption.get(cur.index);
      if (!c || c.estimated || c.value <= 0) continue;
      const earlier: number[] = [];
      for (let k = cur.index - 1; k >= cur.index - 12; k--) {
        const p = consumption.get(k);
        if (p && !p.estimated && p.value > 0) earlier.push(p.value);
      }
      if (earlier.length >= 3) {
        const med = median(earlier);
        if (c.value > 3 * med) {
          const unit = METERS[source as MeterId].unit;
          checks.push({
            level: 'warning',
            code: 'consumption_jump',
            year,
            month: cur.month,
            category: source,
            message: `Szokatlanul nagy ${METERS[source as MeterId].label.toLowerCase()}fogyasztás: ${formatQuantity(c.value, unit)} (medián: ${formatQuantity(med, unit)}).`,
          });
        }
      }
    }
  }

  const file = history.files.get(year);
  for (const rec of file?.months ?? []) {
    const actual = rec.readings.gas?.value;
    const reported = rec.gasReported?.value;
    if (actual !== undefined && reported !== undefined && reported > actual) {
      checks.push({
        level: 'warning',
        code: 'reported_above_actual',
        year,
        month: rec.month,
        category: 'gasReported',
        message: `A diktált gázóra-állás (${reported}) nagyobb, mint a tényleges (${actual}).`,
      });
    }
    for (const id of BILL_IDS) {
      const b = rec.bills[id];
      if (!b || b.paid) continue;
      const overdue = b.dueDate !== undefined && b.dueDate < asOf;
      checks.push({
        level: overdue ? 'warning' : 'info',
        code: overdue ? 'bill_overdue' : 'bill_unpaid',
        year,
        month: rec.month,
        category: id,
        message: overdue
          ? `Lejárt, kifizetetlen számla: ${billLabel(id)} (${ym(year, rec.month)}, határidő: ${formatDate(b.dueDate)}).`
          : `Kifizetetlen számla: ${billLabel(id)} (${ym(year, rec.month)}${b.dueDate ? `, határidő: ${formatDate(b.dueDate)}` : ''}).`,
      });
    }
  }

  // Missing readings for monthly meters whose window has already closed.
  const monthly: { source: ReadingSource; window: { startDay: number; endDay: number } }[] = [
    { source: 'electricity', window: cfg.electricityWindow },
    { source: 'gas', window: cfg.gasWindow },
    { source: 'gasReported', window: cfg.gasWindow },
  ];
  for (const { source, window } of monthly) {
    const first = history.timeline(source)[0];
    if (!first) continue;
    for (const month of MONTHS) {
      const idx = monthIndex(year, month);
      if (idx <= first.index || idx > asOfIndex) continue;
      const { end } = monthlyWindow(year, month, window);
      if (end >= asOf || history.reading(source, year, month)) continue;
      checks.push({
        level: 'warning',
        code: 'reading_missing',
        year,
        month,
        category: source,
        message: `Hiányzik: ${READING_LABEL[source].toLowerCase()} (${ym(year, month)}).`,
      });
    }
  }

  // Water: overdue once the reminder window after the last reading has passed.
  if (year === asOfParts.year) {
    const last = history.latest('water');
    if (last) {
      const overdueFrom = addDays(last.date, cfg.waterIntervalDays + cfg.waterWindowDays);
      if (asOf >= overdueFrom) {
        const { year: y, month: m } = fromMonthIndex(asOfIndex);
        checks.push({
          level: 'warning',
          code: 'reading_missing',
          year: y,
          month: m,
          category: 'water',
          message: `Vízóra-leolvasás késésben (utolsó: ${formatDate(last.date)}).`,
        });
      }
    }
  }

  // Gas plan: is the unreported deficit still absorbable this year?
  for (const month of MONTHS) {
    const rec = history.record(year, month);
    if (!rec?.gasReported || !rec.readings.gas) continue;
    const deficit = rec.readings.gas.value - rec.gasReported.value;
    let remaining = 0;
    for (let m = month + 1; m <= 12; m++) remaining += file?.gasProfile[m as Month] ?? 0;
    if (deficit > 0 && deficit > remaining && Object.keys(file?.gasProfile ?? {}).length > 0) {
      checks.push({
        level: 'warning',
        code: 'gas_deficit',
        year,
        month,
        category: 'gasReported',
        message: `A nem diktált gáz (${formatQuantity(deficit, 'm³')}) több, mint amit az év hátralévő jelleggörbéje elnyel (${formatQuantity(remaining, 'm³')}).`,
      });
    }
  }

  const order: Record<CheckLevel, number> = { error: 0, warning: 1, info: 2 };
  return checks.sort((a, b) => order[a.level] - order[b.level] || a.month - b.month || a.code.localeCompare(b.code));
}

function billLabel(id: BillId): string {
  return BILLS[id].label;
}
