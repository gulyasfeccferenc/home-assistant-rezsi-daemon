import {
  BILLS,
  BILL_IDS,
  computeYear,
  daysInMonth,
  formatDate,
  formatHuf,
  formatPercent,
  formatQuantity,
  isoDate,
  METERS,
  METER_IDS,
  monthName,
  type CalcConfig,
  type History,
} from '@rezsi/shared';

const SP = ' ';
const q = (v: number | undefined, unit: string, d = 2) => formatQuantity(v, unit, d, SP);
const huf = (v: number | undefined) => formatHuf(v, SP);
const pct = (v: number | undefined) => formatPercent(v, SP);

function table(head: string[], rows: string[][]): string {
  const align = head.map((_, i) => (i === 0 ? ':--' : '--:'));
  return [head, align, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

/**
 * Human-readable monthly report. Checks are evaluated as of the last day of the month (or today
 * for the running month), so reports of finished months depend only on the data (stable diffs).
 */
export function monthlyReport(history: History, year: number, month: number, cfg: CalcConfig, today: string): string {
  const endOfMonth = isoDate(year, month, daysInMonth(year, month));
  const asOf = today < endOfMonth ? today : endOfMonth;
  const computed = computeYear(history, year, cfg, asOf);
  const cm = computed.months[month - 1];
  const rec = history.record(year, month);
  const out: string[] = [`# Rezsi – ${year}. ${monthName(month, false)}`, ''];

  out.push('## Mérőállások és fogyasztás', '');
  out.push(
    table(
      ['Mérő', 'Óraállás', 'Dátum', 'Fogyasztás', 'Tavaly', 'Változás'],
      METER_IDS.map((m) => {
        const r = rec?.readings[m];
        const c = cm.consumption[m];
        const unit = METERS[m].unit;
        return [
          METERS[m].label,
          r ? q(r.value, unit) : '–',
          r ? formatDate(r.date) : '–',
          c ? q(c.value, unit) + (c.estimated ? ' (becsült)' : '') : '–',
          q(cm.lastYearConsumption[m]?.value, unit),
          cm.yoy[m] ? pct(cm.yoy[m]!.percent) : '–',
        ];
      }),
    ),
    '',
  );

  out.push('## Gáz diktálás', '');
  out.push(
    table(
      ['', 'Érték'],
      [
        ['Diktált óraállás', rec?.gasReported ? `${q(rec.gasReported.value, 'm³')} (${formatDate(rec.gasReported.date)})` : '–'],
        ['Számlázott fogyasztás', q(cm.billedGas?.value, 'm³')],
        ['Jelleggörbe', q(history.files.get(year)?.gasProfile[month as 1], 'm³')],
        ['Nem diktált (tényleges − diktált)', q(cm.gasDeficit, 'm³')],
      ],
    ),
    '',
  );

  out.push('## Számlák', '');
  const billRows = BILL_IDS.filter((id) => rec?.bills[id]).map((id) => {
    const b = rec!.bills[id]!;
    const unit = cm.unitPrice[id];
    return [
      BILLS[id].label,
      huf(b.amount),
      b.paid ? 'fizetve' : '**nincs fizetve**',
      formatDate(b.dueDate),
      unit !== undefined ? `${huf(unit)}/${METERS[id as keyof typeof METERS].unit}` : '–',
    ];
  });
  out.push(billRows.length ? table(['Tétel', 'Összeg', 'Állapot', 'Határidő', 'Egységár'], billRows) : '_Nincs rögzített számla._', '');

  // Year to date up to and including this month.
  let ytd = 0;
  let lastYtd = 0;
  for (const m of computed.months.slice(0, month)) {
    ytd += m.total ?? 0;
    lastYtd += m.lastYearTotal ?? 0;
  }
  out.push('## Összesen', '');
  out.push(
    table(
      ['', 'Idén', 'Tavaly', 'Változás'],
      [
        ['Havi összesen', huf(cm.total), huf(cm.lastYearTotal), cm.total && cm.lastYearTotal ? pct(((cm.total - cm.lastYearTotal) / cm.lastYearTotal) * 100) : '–'],
        ['Év elejétől', huf(ytd), huf(lastYtd || undefined), ytd && lastYtd ? pct(((ytd - lastYtd) / lastYtd) * 100) : '–'],
      ],
    ),
    '',
  );

  const checks = computed.checks.filter((c) => c.month === month);
  out.push('## Figyelmeztetések', '');
  if (checks.length === 0) out.push('_Nincs._');
  else for (const c of checks) out.push(`- ${c.level === 'error' ? '❌' : c.level === 'warning' ? '⚠️' : 'ℹ️'} ${c.message}`);

  if (rec?.note) out.push('', '## Megjegyzés', '', rec.note);
  return out.join('\n') + '\n';
}
