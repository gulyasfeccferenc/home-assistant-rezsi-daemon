import { BILL_IDS, METERS, METER_IDS, MONTHS, type YearFile } from '@rezsi/shared';

export const CSV_HEADER = ['year', 'month', 'category', 'kind', 'value', 'unit', 'date', 'paid'] as const;

function cell(v: string | number | boolean | undefined): string {
  if (v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Long-format CSV with raw (entered) values only; derived values are recomputed from these. */
export function yearToCsv(file: YearFile): string {
  const rows: (string | number | boolean | undefined)[][] = [];
  for (const rec of file.months) {
    for (const meter of METER_IDS) {
      const r = rec.readings[meter];
      if (r) rows.push([file.year, rec.month, meter, 'reading', r.value, METERS[meter].unit, r.date, undefined]);
    }
    if (rec.gasReported) {
      rows.push([file.year, rec.month, 'gas', 'reported', rec.gasReported.value, 'm³', rec.gasReported.date, undefined]);
    }
    for (const id of BILL_IDS) {
      const b = rec.bills[id];
      if (b) rows.push([file.year, rec.month, id, 'bill', b.amount, 'HUF', b.dueDate, b.paid]);
    }
  }
  for (const m of MONTHS) {
    const v = file.gasProfile[m];
    if (v !== undefined) rows.push([file.year, m, 'gas', 'profile', v, 'm³', undefined, undefined]);
  }
  if (file.annualTargets?.gas !== undefined) rows.push([file.year, undefined, 'gas', 'target', file.annualTargets.gas, 'm³', undefined, undefined]);
  if (file.annualTargets?.electricity !== undefined) {
    rows.push([file.year, undefined, 'electricity', 'target', file.annualTargets.electricity, 'kWh', undefined, undefined]);
  }
  return [CSV_HEADER.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';
}
