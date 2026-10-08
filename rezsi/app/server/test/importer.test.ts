import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { cellNumber, formatImportReport, normalizeLabel, parseSheetWorkbook } from '../src/importer.js';

const MONTHS = ['Január', 'Február', 'Március', 'Április', 'Május', 'Június', 'Július', 'Augusztus', 'Szeptember', 'Október', 'November', 'December'];

/** Builds a fictional workbook in the layout of the owner's Google Sheet. */
async function fixture(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = (year: number, rows: [string, ...(number | string | undefined)[][]][], months: number[]) => {
    const ws = wb.addWorksheet(`${year} - Rezsi`);
    for (const [i, m] of months.entries()) {
      const c = 2 + i * 2;
      ws.mergeCells(1, c, 1, c + 1);
      ws.getCell(1, c).value = `${MONTHS[m - 1]} (${year}.${String(m).padStart(2, '0')}.10.)`;
      ws.getCell(2, c).value = 'Óraállás';
      ws.getCell(2, c + 1).value = 'Fizetendő';
    }
    let r = 3;
    for (const [label, ...months] of rows) {
      ws.getCell(r, 1).value = label;
      months.forEach(([reading, payable], i) => {
        const c = 2 + i * 2;
        if (reading !== undefined) ws.getCell(r, c).value = reading;
        if (payable !== undefined) ws.getCell(r, c + 1).value = payable;
      });
      r++;
    }
    return ws;
  };

  sheet(
    2025,
    [
      ['Gáz', [5000, 30000], [5300, 28000], [5500, 20000]],
      ['Gáz diktált/diktálandó', [4950], [5200], [5450]],
      ['Villany', [40000, 13000], [40200, 12000], [40400, 12500]],
      ['Telekom', [undefined, 9990], [undefined, 9990], [undefined, 9990]],
      ['Víz', [480, undefined], [undefined, undefined], [490, 8000]],
      ['Szemétszállítás', [undefined, 18000], [], []],
      ['Fa', [undefined, 120000], [], []],
    ],
    [10, 11, 12],
  );
  const ws = sheet(
    2026,
    [
      ['Gáz', [5800, '31 000 Ft'], [6100, { formula: 'B3*2', result: 29000 } as never]],
      ['Gáz diktált/diktálandó', [5700], [5950]],
      ['Villany', [40600, 13100], [40800, 12900]],
      ['Hidden helper row', [1, 2]],
      ['Telekom', [undefined, 10990], [undefined, 10990]],
      ['Víz', [500, 9000], [undefined, undefined]],
      ['Szemétszállítás', [], []],
      ['Fa', [undefined, 50000], []],
      ['Összesen', [undefined, 470000], [undefined, 52890]],
      ['Fogyasztás', [], []],
      ['Áram', [200], [200]],
      ['Gáz', [300], [300]],
      ['Víz', [10], []],
      ['Tavalyi áram', [999], []],
      ['Tavalyi gáz', [undefined], [undefined]],
      ['Gázfogyasztási jelleggörbe', [400], [350]],
      ['Gáz összesen', [2100]],
      ['Áram összesen', [2250]],
    ],
    [1, 2],
  );
  ws.getRow(6).hidden = true;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('sheet import', () => {
  it('normalizes labels and numbers', () => {
    expect(normalizeLabel('  Gáz diktált/diktálandó ')).toBe('gaz diktalt/diktalando');
    expect(cellNumber('12 345 Ft')).toBe(12345);
    expect(cellNumber('1 234,5')).toBe(1234.5);
    expect(cellNumber({ formula: 'A1', result: 7 } as never)).toBe(7);
    expect(cellNumber('–')).toBeUndefined();
  });

  it('maps rows by label, ignores Fa, and reports mismatches', async () => {
    const report = await parseSheetWorkbook(await fixture(), { today: '2026-02-15' });
    expect(report.years.map((y) => y.year)).toEqual([2025, 2026]);
    const y26 = report.years[1];
    const jan = y26.months[0];
    expect(jan.readings.gas).toEqual({ value: 5800, date: '2026-01-10' });
    expect(jan.gasReported).toEqual({ value: 5700, date: '2026-01-10' });
    expect(jan.bills.gas).toEqual({ amount: 31000, paid: true });
    expect(y26.months[1].bills.gas).toEqual({ amount: 29000, paid: false }); // current month: unpaid
    expect(jan.bills.telecom?.amount).toBe(10990);
    expect(jan.readings.water?.value).toBe(500);
    expect(y26.gasProfile).toEqual({ 1: 400, 2: 350 });
    expect(y26.annualTargets).toEqual({ gas: 2100, electricity: 2250 });
    // Fa is not a category.
    expect(JSON.stringify(report.years)).not.toContain('120000');
    expect(report.years[0].months[0]).toMatchObject({ month: 10, bills: { waste: { amount: 18000 } } });
    expect(report.warnings.join(' ')).toContain('Hidden helper row');

    const rows = report.mismatches.map((m) => `${m.year}-${m.month} ${m.row} ${m.sheet}/${m.computed ?? '-'}`);
    expect(rows).toEqual([
      '2026-1 Összesen 470000/64090',
      '2026-1 Tavalyi electricity 999/-',
    ]);
    expect(formatImportReport(report)).toContain('Eltérések');
  });
});
