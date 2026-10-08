import ExcelJS from 'exceljs';
import {
  computeYear,
  DEFAULT_CALC_CONFIG,
  emptyYearFile,
  History,
  isoDate,
  isValidIsoDate,
  MONTH_NAMES_HU,
  yearFileSchema,
  describeZodError,
  type BillId,
  type CalcConfig,
  type MeterId,
  type Month,
  type MonthRecord,
  type YearFile,
} from '@rezsi/shared';

/**
 * One-time import of the Google Sheet export ("2025 - Rezsi", "2026 - Rezsi" tabs as xlsx).
 * Rows are matched by the label in column A (never by row number: the sheet has hidden and
 * grouped rows). Derived rows are not imported; they are compared with recomputed values instead.
 */

export interface ImportMismatch {
  year: number;
  month?: number;
  row: string;
  sheet: number;
  computed?: number;
}

export interface ImportReport {
  years: YearFile[];
  /** Short summary lines per year. */
  summary: string[];
  mismatches: ImportMismatch[];
  warnings: string[];
}

/** Lowercase, no diacritics, single spaces, no punctuation at the ends. */
export function normalizeLabel(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();
}

const MONTH_KEYS = MONTH_NAMES_HU.map((m) => normalizeLabel(m));

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}

/** Numeric value of a cell (numbers, formula results, or text like "12 345 Ft" / "1 234,5"). */
export function cellNumber(v: ExcelJS.CellValue): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'object' && v && 'result' in v) return cellNumber(v.result as ExcelJS.CellValue);
  if (typeof v === 'object' && v && 'error' in v) return undefined;
  const s = cellText(v).replace(/[\s\u00A0\u202F]/g, '').replace(/(Ft|HUF|m3|m³|kWh)$/i, '');
  if (!s || s === '-' || s === '–') return undefined;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : undefined;
}

interface MonthColumns {
  month: number;
  date?: string;
  reading: number;
  payable: number;
}

type RowKind =
  | { kind: 'meter'; meter: MeterId; bill?: BillId }
  | { kind: 'reported' }
  | { kind: 'bill'; bill: BillId }
  | { kind: 'ignore' }
  | { kind: 'sheetTotal' }
  | { kind: 'consumption'; meter: MeterId }
  | { kind: 'lastYear'; meter: MeterId }
  | { kind: 'profile' }
  | { kind: 'target'; meter: 'gas' | 'electricity' }
  | { kind: 'section' };

const METER_WORDS: Record<string, MeterId> = { gaz: 'gas', aram: 'electricity', villany: 'electricity', viz: 'water' };

function classify(label: string, inConsumptionBlock: boolean): RowKind | undefined {
  const l = normalizeLabel(label);
  if (!l) return undefined;
  if (l === 'fa' || l.startsWith('fa ')) return { kind: 'ignore' };
  if (l.includes('jelleggorbe')) return { kind: 'profile' };
  if (l.startsWith('gaz dikt')) return { kind: 'reported' };
  if (l.startsWith('tavalyi')) {
    const w = l.split(' ')[1];
    return METER_WORDS[w] ? { kind: 'lastYear', meter: METER_WORDS[w] } : { kind: 'ignore' };
  }
  const total = /^(gaz|aram|villany) osszesen/.exec(l);
  if (total) return { kind: 'target', meter: total[1] === 'gaz' ? 'gas' : 'electricity' };
  if (l === 'osszesen') return { kind: 'sheetTotal' };
  if (l.startsWith('fogyasztas')) {
    const w = l.split(' ')[1];
    return w && METER_WORDS[w] ? { kind: 'consumption', meter: METER_WORDS[w] } : { kind: 'section' };
  }
  const first = l.split(' ')[0];
  if (inConsumptionBlock && METER_WORDS[first]) return { kind: 'consumption', meter: METER_WORDS[first] };
  if (l.startsWith('telekom')) return { kind: 'bill', bill: 'telecom' };
  if (l.startsWith('szemet')) return { kind: 'bill', bill: 'waste' };
  if (l === 'gaz') return { kind: 'meter', meter: 'gas', bill: 'gas' };
  if (l === 'villany' || l === 'aram') return { kind: 'meter', meter: 'electricity', bill: 'electricity' };
  if (l === 'viz') return { kind: 'meter', meter: 'water', bill: 'water' };
  return undefined;
}

/** Finds month columns from the header rows (row 1: month names with dates, row 2: sub-headers). */
function monthColumns(ws: ExcelJS.Worksheet, year: number, warnings: string[]): MonthColumns[] {
  const header = ws.getRow(1);
  const sub = ws.getRow(2);
  const found = new Map<number, MonthColumns>();
  const lastCol = Math.max(ws.columnCount, header.cellCount);
  for (let c = 2; c <= lastCol; c++) {
    const cell = header.getCell(c);
    if (cell.isMerged && cell.master.address !== cell.address) continue;
    const text = cellText(cell.value);
    const norm = normalizeLabel(text);
    const idx = MONTH_KEYS.findIndex((m) => norm.startsWith(m));
    if (idx < 0) continue;
    const month = idx + 1;
    if (found.has(month)) continue;
    let date: string | undefined;
    const dm = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/.exec(text);
    if (dm) {
      const d = isoDate(Number(dm[1]), Number(dm[2]), Number(dm[3]));
      if (isValidIsoDate(d)) date = d;
    }
    // Sub-headers decide which of the two columns holds the reading and which the payable amount.
    let reading = c;
    let payable = c + 1;
    for (const col of [c, c + 1]) {
      const s = normalizeLabel(cellText(sub.getCell(col).value));
      if (s.startsWith('oraallas')) reading = col;
      else if (s.startsWith('fizetendo')) payable = col;
    }
    if (reading === payable) payable = reading + 1;
    found.set(month, { month, date, reading, payable });
  }
  if (found.size === 0) warnings.push(`${year}: nem találtam hónap-fejléceket az 1. sorban.`);
  return [...found.values()].sort((a, b) => a.month - b.month);
}

function sheetYear(ws: ExcelJS.Worksheet): number | undefined {
  const m = /(20\d{2})/.exec(ws.name);
  return m ? Number(m[1]) : undefined;
}

function defaultDate(year: number, month: number): string {
  return isoDate(year, month, 1);
}

interface SheetExtras {
  sheetTotals: Map<number, number>;
  consumption: Map<string, number>;
  lastYear: Map<string, number>;
}

function parseSheet(ws: ExcelJS.Worksheet, year: number, paidBefore: string, warnings: string[]): { file: YearFile; extras: SheetExtras } {
  const file = emptyYearFile(year);
  const extras: SheetExtras = { sheetTotals: new Map(), consumption: new Map(), lastYear: new Map() };
  const cols = monthColumns(ws, year, warnings);
  const records = new Map<number, MonthRecord>();
  const rec = (month: number) => {
    let r = records.get(month);
    if (!r) records.set(month, (r = { month, readings: {}, bills: {} }));
    return r;
  };
  const unknown = new Set<string>();
  let inConsumption = false;

  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const label = cellText(row.getCell(1).value).trim();
    if (!label) continue;
    const kind = classify(label, inConsumption);
    if (!kind) {
      unknown.add(label);
      continue;
    }
    if (kind.kind === 'section') {
      inConsumption = true;
      continue;
    }
    if (kind.kind !== 'consumption') inConsumption = false;
    if (kind.kind === 'ignore') continue;

    if (kind.kind === 'target') {
      // The annual target is the first number in the row.
      for (let c = 2; c <= ws.columnCount; c++) {
        const n = cellNumber(row.getCell(c).value);
        if (n !== undefined) {
          file.annualTargets = { ...file.annualTargets, [kind.meter]: n };
          break;
        }
      }
      continue;
    }

    for (const mc of cols) {
      const reading = cellNumber(row.getCell(mc.reading).value);
      const payable = cellNumber(row.getCell(mc.payable).value);
      const date = mc.date ?? defaultDate(year, mc.month);
      const key = `${mc.month}`;
      switch (kind.kind) {
        case 'meter':
          if (reading !== undefined) rec(mc.month).readings[kind.meter] = { value: reading, date };
          if (payable !== undefined && kind.bill) {
            rec(mc.month).bills[kind.bill] = { amount: Math.round(payable), paid: date < paidBefore };
          }
          break;
        case 'reported': {
          const v = reading ?? payable;
          if (v !== undefined) rec(mc.month).gasReported = { value: v, date };
          break;
        }
        case 'bill': {
          const v = payable ?? reading;
          if (v !== undefined) rec(mc.month).bills[kind.bill] = { amount: Math.round(v), paid: date < paidBefore };
          break;
        }
        case 'sheetTotal': {
          const v = payable ?? reading;
          if (v !== undefined) extras.sheetTotals.set(mc.month, v);
          break;
        }
        case 'consumption': {
          const v = reading ?? payable;
          if (v !== undefined) extras.consumption.set(`${kind.meter}:${key}`, v);
          break;
        }
        case 'lastYear': {
          const v = reading ?? payable;
          if (v !== undefined) extras.lastYear.set(`${kind.meter}:${key}`, v);
          break;
        }
        case 'profile': {
          const v = reading ?? payable;
          if (v !== undefined) file.gasProfile[mc.month as Month] = v;
          break;
        }
      }
    }
  }
  if (unknown.size) warnings.push(`${year}: ismeretlen sorok (kihagyva): ${[...unknown].join(', ')}`);
  file.months = [...records.values()].sort((a, b) => a.month - b.month);
  return { file, extras };
}

export async function parseSheetWorkbook(
  data: Buffer | ArrayBuffer,
  { today, cfg = DEFAULT_CALC_CONFIG }: { today: string; cfg?: CalcConfig },
): Promise<ImportReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const warnings: string[] = [];
  const parsed: { file: YearFile; extras: SheetExtras }[] = [];
  // Bills of months before the current one are assumed paid; the sheet has no paid column.
  const paidBefore = today.slice(0, 7) + '-01';
  for (const ws of wb.worksheets) {
    const year = sheetYear(ws);
    if (!year) {
      warnings.push(`"${ws.name}" munkalap kihagyva (nincs évszám a nevében).`);
      continue;
    }
    if (parsed.some((p) => p.file.year === year)) {
      warnings.push(`"${ws.name}" munkalap kihagyva (${year} már beolvasva).`);
      continue;
    }
    parsed.push(parseSheet(ws, year, paidBefore, warnings));
  }

  const years: YearFile[] = [];
  for (const p of parsed) {
    const v = yearFileSchema.safeParse(p.file);
    if (!v.success) throw new Error(`${p.file.year}: ${describeZodError(v.error)}`);
    years.push(v.data);
  }

  // Compare the sheet's derived rows with recomputed values.
  const history = new History(years);
  const mismatches: ImportMismatch[] = [];
  const summary: string[] = [];
  const close = (a: number, b: number) => Math.abs(a - b) < 0.5;
  for (const { file, extras } of parsed) {
    const computed = computeYear(history, file.year, cfg, `${file.year}-12-31`);
    for (const [k, sheet] of extras.consumption) {
      const [meter, m] = k.split(':');
      const c = computed.months[Number(m) - 1].consumption[meter as MeterId]?.value;
      if (c === undefined || !close(c, sheet)) mismatches.push({ year: file.year, month: Number(m), row: `Fogyasztás ${meter}`, sheet, computed: c });
    }
    for (const [k, sheet] of extras.lastYear) {
      const [meter, m] = k.split(':');
      const c = computed.months[Number(m) - 1].lastYearConsumption[meter as MeterId]?.value;
      if (c === undefined || !close(c, sheet)) mismatches.push({ year: file.year, month: Number(m), row: `Tavalyi ${meter}`, sheet, computed: c });
    }
    for (const [m, sheet] of extras.sheetTotals) {
      const c = computed.months[m - 1].total;
      if (c === undefined || !close(c, sheet)) mismatches.push({ year: file.year, month: m, row: 'Összesen', sheet, computed: c });
    }
    const bills = file.months.reduce((n, r) => n + Object.keys(r.bills).length, 0);
    const readings = file.months.reduce((n, r) => n + Object.keys(r.readings).length + (r.gasReported ? 1 : 0), 0);
    summary.push(
      `${file.year}: ${file.months.length} hónap, ${readings} óraállás, ${bills} számla, ` +
        `jelleggörbe ${Object.keys(file.gasProfile).length} hónapra` +
        (file.annualTargets ? `, éves célok: ${JSON.stringify(file.annualTargets)}` : ''),
    );
  }
  mismatches.sort((a, b) => a.year - b.year || (a.month ?? 0) - (b.month ?? 0) || a.row.localeCompare(b.row));
  return { years, summary, mismatches, warnings };
}

export function formatImportReport(report: ImportReport): string {
  const lines = ['Import összegzés:', ...report.summary.map((s) => `  ${s}`)];
  if (report.warnings.length) lines.push('Figyelmeztetések:', ...report.warnings.map((w) => `  - ${w}`));
  if (report.mismatches.length) {
    lines.push(`Eltérések a táblázat és az újraszámolt értékek között (${report.mismatches.length}):`);
    for (const m of report.mismatches) {
      lines.push(`  ${m.year}.${String(m.month ?? '').padStart(2, '0')} ${m.row}: táblázat ${m.sheet}, számolt ${m.computed ?? '–'}`);
    }
  } else {
    lines.push('Nincs eltérés.');
  }
  return lines.join('\n');
}
