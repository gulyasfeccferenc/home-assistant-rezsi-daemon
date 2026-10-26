import { METER_IDS } from './categories.js';
import type { ReadingSource } from './calc.js';
import { monthIndex } from './dates.js';
import type { MonthRecord, Reading, YearFile } from './schema.js';

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

/**
 * Meter readings never go down. After a month is saved, every later month (also in later years)
 * whose reading of the same meter is lower than the saved one is raised to it; later readings
 * that are already at least as high stay untouched. Dates are kept.
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
      for (const src of [...METER_IDS, 'gasReported'] as ReadingSource[]) {
        const base = reading(source, src);
        const later = reading(rec, src);
        if (!base || !later || later.value >= base.value) continue;
        copy ??= structuredClone(file);
        const target = copy.months[i];
        const updated = { ...later, value: base.value };
        if (src === 'gasReported') target.gasReported = updated;
        else target.readings[src] = updated;
        adjustments.push({ year: file.year, month: rec.month, source: src, from: later.value, to: base.value });
      }
    }
    if (copy) changed.push(copy);
  }
  return { changed, adjustments };
}
