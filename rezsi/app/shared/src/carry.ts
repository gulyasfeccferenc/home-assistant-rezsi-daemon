import { METER_IDS } from './categories.js';
import type { ReadingSource } from './calc.js';
import { monthIndex } from './dates.js';
import type { MonthRecord, Reading, YearFile } from './schema.js';

const SOURCES = [...METER_IDS, 'gasReported'] as ReadingSource[];

export interface CarryAdjustment {
  year: number;
  month: number;
  source: ReadingSource;
  from: number;
  to: number;
}

function reading(rec: MonthRecord, source: ReadingSource): Reading | undefined {
  return source === 'gasReported' ? rec.gasReported : rec.readings[source];
}

function setReading(rec: MonthRecord, source: ReadingSource, r: Reading): void {
  if (source === 'gasReported') rec.gasReported = r;
  else rec.readings[source] = r;
}

/**
 * Meter readings never go down. After a month is saved, every later month (also in later years)
 * whose reading of the same meter is lower than the saved one is raised to it; later readings
 * that are already at least as high stay untouched. Dates are kept. Raised values are marked
 * `carried`: they are placeholders until the real reading of that month is entered, so they do
 * not stop that month's reminder.
 *
 * Returns the year files that changed (copies) and the list of adjustments.
 */
export function carryForward(
  files: YearFile[],
  year: number,
  month: number,
): { changed: YearFile[]; adjustments: CarryAdjustment[] } {
  const source = files.find((f) => f.year === year)?.months.find((m) => m.month === month);
  if (!source) return { changed: [], adjustments: [] };
  const from = monthIndex(year, month);
  const adjustments: CarryAdjustment[] = [];
  const changed: YearFile[] = [];

  for (const file of [...files].sort((x, y) => x.year - y.year)) {
    if (file.year < year) continue;
    let copy: YearFile | undefined;
    for (const [i, rec] of file.months.entries()) {
      if (monthIndex(file.year, rec.month) <= from) continue;
      for (const src of SOURCES) {
        const base = reading(source, src);
        const later = reading(rec, src);
        if (!base || base.carried || !later || later.value >= base.value) continue;
        copy ??= structuredClone(file);
        setReading(copy.months[i], src, { value: base.value, date: later.date, carried: true });
        adjustments.push({ year: file.year, month: rec.month, source: src, from: later.value, to: base.value });
      }
    }
    if (copy) changed.push(copy);
  }
  return { changed, adjustments };
}

export interface CarriedMark {
  year: number;
  month: number;
  source: ReadingSource;
  value: number;
}

/**
 * Marks readings that merely repeat the previous reading of the same meter as `carried`
 * placeholders (the original sheet copied values into months that were not read yet, and
 * carry-forward before version 0.2.1 did not mark the values it raised). A real reading with
 * zero consumption is marked too; entering it again in the form makes it an actual reading.
 */
export function markCarriedDuplicates(files: YearFile[]): { changed: YearFile[]; marks: CarriedMark[] } {
  const copies = [...files].sort((a, b) => a.year - b.year).map((f) => structuredClone(f));
  const changedYears = new Set<number>();
  const marks: CarriedMark[] = [];
  for (const src of SOURCES) {
    let previous: number | undefined;
    for (const file of copies) {
      for (const rec of [...file.months].sort((a, b) => a.month - b.month)) {
        const r = reading(rec, src);
        if (!r) continue;
        if (!r.carried && previous !== undefined && r.value === previous) {
          setReading(rec, src, { ...r, carried: true });
          changedYears.add(file.year);
          marks.push({ year: file.year, month: rec.month, source: src, value: r.value });
        }
        previous = r.value;
      }
    }
  }
  marks.sort((a, b) => a.year - b.year || a.month - b.month || a.source.localeCompare(b.source));
  return { changed: copies.filter((f) => changedYears.has(f.year)), marks };
}
