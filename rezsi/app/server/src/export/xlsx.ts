import ExcelJS from 'exceljs';
import {
  BILLS,
  computeYear,
  daysInMonth,
  formatDate,
  isoDate,
  METERS,
  METER_IDS,
  monthName,
  MONTHS,
  TOTAL_FILL,
  type BillId,
  type CalcConfig,
  type History,
  type Month,
} from '@rezsi/shared';

const HUF = '#,##0 "Ft"';
const QTY = '#,##0.##';

type Cellish = number | string | undefined;

interface RowSpec {
  label: string;
  fill?: string;
  /** Per month: [reading column, payable column]. */
  values: (month: Month) => [Cellish, Cellish];
  readingFormat?: string;
  payableFormat?: string;
  /** Value of the "Összesen" column (reading, payable). */
  total?: [Cellish, Cellish];
  bold?: boolean;
  italic?: (month: Month) => boolean;
}

function argb(hex: string): string {
  return 'FF' + hex.replace('#', '').toUpperCase();
}

/** Worksheet in the layout of the original Google Sheet: categories as rows, two columns per month. */
export async function yearToXlsx(history: History, year: number, cfg: CalcConfig): Promise<Buffer> {
  const computed = computeYear(history, year, cfg, isoDate(year, 12, daysInMonth(year, 12)));
  const file = history.files.get(year);
  const rec = (m: number) => history.record(year, m);
  const cm = (m: number) => computed.months[m - 1];
  const bill = (m: number, id: BillId) => rec(m)?.bills[id]?.amount;

  const wb = new ExcelJS.Workbook();
  // Fixed metadata keeps the file content stable between exports.
  wb.creator = 'Rezsi';
  wb.created = new Date(Date.UTC(year, 0, 1));
  wb.modified = new Date(Date.UTC(year, 0, 1));
  const ws = wb.addWorksheet(`${year} - Rezsi`, { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });

  ws.getColumn(1).width = 30;
  ws.getCell(1, 1).value = `${year}`;
  for (const m of MONTHS) {
    const c = 2 + (m - 1) * 2;
    ws.mergeCells(1, c, 1, c + 1);
    const r = rec(m);
    const date = r?.readings.gas?.date ?? r?.readings.electricity?.date ?? r?.readings.water?.date ?? r?.gasReported?.date;
    ws.getCell(1, c).value = date ? `${monthName(m)} (${formatDate(date)})` : monthName(m);
    ws.getCell(2, c).value = 'Óraállás';
    ws.getCell(2, c + 1).value = 'Fizetendő';
    ws.getColumn(c).width = 12;
    ws.getColumn(c + 1).width = 13;
  }
  const totalCol = 2 + 24;
  ws.mergeCells(1, totalCol, 1, totalCol + 1);
  ws.getCell(1, totalCol).value = 'Összesen';
  ws.getCell(2, totalCol).value = 'Mennyiség';
  ws.getCell(2, totalCol + 1).value = 'Fizetendő';
  ws.getColumn(totalCol).width = 12;
  ws.getColumn(totalCol + 1).width = 14;
  ws.getRow(1).font = { bold: true };
  ws.getRow(2).font = { italic: true };

  const t = computed.totals;
  const rows: (RowSpec | null)[] = [
    {
      label: 'Gáz',
      fill: METERS.gas.fill,
      values: (m) => [rec(m)?.readings.gas?.value, bill(m, 'gas')],
      total: [undefined, t.byBill.gas],
    },
    { label: 'Gáz diktált', fill: METERS.gas.fill, values: (m) => [rec(m)?.gasReported?.value, undefined] },
    {
      label: 'Villany',
      fill: METERS.electricity.fill,
      values: (m) => [rec(m)?.readings.electricity?.value, bill(m, 'electricity')],
      total: [undefined, t.byBill.electricity],
    },
    { label: 'Telekom', fill: BILLS.telecom.fill, values: (m) => [undefined, bill(m, 'telecom')], total: [undefined, t.byBill.telecom] },
    {
      label: 'Víz',
      fill: METERS.water.fill,
      values: (m) => [rec(m)?.readings.water?.value, bill(m, 'water')],
      total: [undefined, t.byBill.water],
    },
    { label: 'Szemétszállítás', fill: BILLS.waste.fill, values: (m) => [undefined, bill(m, 'waste')], total: [undefined, t.byBill.waste] },
    { label: 'Összesen', fill: TOTAL_FILL, bold: true, values: (m) => [undefined, cm(m).total], total: [undefined, t.ytd] },
    null,
    { label: 'Fogyasztás', bold: true, values: () => [undefined, undefined] },
    ...METER_IDS.map(
      (meter): RowSpec => ({
        label: `${METERS[meter].label} (${METERS[meter].unit})`,
        fill: METERS[meter].fill,
        values: (m) => [cm(m).consumption[meter]?.value, undefined],
        readingFormat: '#,##0.0',
        italic: (m) => !!cm(m).consumption[meter]?.estimated,
        total: [t.consumption[meter], undefined],
      }),
    ),
    {
      label: 'Gáz diktált fogyasztás (m³)',
      fill: METERS.gas.fill,
      values: (m) => [cm(m).billedGas?.value, undefined],
      readingFormat: '#,##0.0',
      total: [t.billedGas, undefined],
    },
    ...METER_IDS.map(
      (meter): RowSpec => ({
        label: `Tavalyi ${METERS[meter].label.toLowerCase()} (${METERS[meter].unit})`,
        values: (m) => [cm(m).lastYearConsumption[meter]?.value, undefined],
        readingFormat: '#,##0.0',
      }),
    ),
    {
      label: 'Gázfogyasztási jelleggörbe (m³)',
      fill: METERS.gas.fill,
      values: (m) => [file?.gasProfile[m], undefined],
      total: [t.gasProfileTotal || undefined, undefined],
    },
    null,
    { label: 'Gáz összesen (éves cél, m³)', values: () => [undefined, undefined], total: [file?.annualTargets?.gas, undefined] },
    { label: 'Áram összesen (éves cél, kWh)', values: () => [undefined, undefined], total: [file?.annualTargets?.electricity, undefined] },
  ];

  let r = 3;
  for (const spec of rows) {
    if (!spec) {
      r++;
      continue;
    }
    const row = ws.getRow(r);
    row.getCell(1).value = spec.label;
    if (spec.bold) row.font = { bold: true };
    const lastCol = totalCol + 1;
    for (const m of MONTHS) {
      const c = 2 + (m - 1) * 2;
      const [reading, payable] = spec.values(m);
      if (reading !== undefined) {
        const cell = row.getCell(c);
        cell.value = reading;
        cell.numFmt = spec.readingFormat ?? QTY;
        if (spec.italic?.(m)) cell.font = { italic: true, color: { argb: 'FF666666' } };
      }
      if (payable !== undefined) {
        const cell = row.getCell(c + 1);
        cell.value = payable;
        cell.numFmt = spec.payableFormat ?? HUF;
      }
    }
    if (spec.total) {
      const [q, p] = spec.total;
      if (q !== undefined) Object.assign(row.getCell(totalCol), { value: q, numFmt: spec.readingFormat ?? QTY });
      if (p !== undefined) Object.assign(row.getCell(totalCol + 1), { value: p, numFmt: HUF });
    }
    if (spec.fill) {
      for (let c = 1; c <= lastCol; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(spec.fill) } };
      }
    }
    r++;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
