import { emptyYearFile, type BillId, type MonthRecord, type YearFile } from '../src/index.js';

type Rec = {
  gas?: number;
  electricity?: number;
  water?: number;
  reported?: number;
  bills?: Partial<Record<BillId, number | { amount: number; paid?: boolean; dueDate?: string }>>;
  day?: number;
};

/** Builds a year file from a compact month -> values map. */
export function year(y: number, months: Record<number, Rec>, extra: Partial<YearFile> = {}): YearFile {
  const file = emptyYearFile(y);
  for (const [m, r] of Object.entries(months)) {
    const month = Number(m);
    const date = `${y}-${String(month).padStart(2, '0')}-${String(r.day ?? 10).padStart(2, '0')}`;
    const rec: MonthRecord = { month, readings: {}, bills: {} };
    if (r.gas !== undefined) rec.readings.gas = { value: r.gas, date };
    if (r.electricity !== undefined) rec.readings.electricity = { value: r.electricity, date };
    if (r.water !== undefined) rec.readings.water = { value: r.water, date };
    if (r.reported !== undefined) rec.gasReported = { value: r.reported, date };
    for (const [id, b] of Object.entries(r.bills ?? {})) {
      rec.bills[id as BillId] = typeof b === 'number' ? { amount: b, paid: true } : { paid: true, ...b };
    }
    file.months.push(rec);
  }
  return { ...file, ...extra };
}
