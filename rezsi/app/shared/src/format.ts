// Hungarian number and date formatting, implemented by hand so that output is identical
// in every runtime (browser, Node with or without full ICU) and in snapshot tests.

const NBSP = '\u00A0';

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** `1234567.5` -> `1 234 567,5` (non-breaking spaces, decimal comma). */
export function formatNumber(value: number, maxDecimals = 2, sep = NBSP): string {
  if (!Number.isFinite(value)) return '–';
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(Math.abs(value) * factor) / factor;
  const [intPart, frac = ''] = rounded.toFixed(maxDecimals).split('.');
  const trimmed = frac.replace(/0+$/, '');
  const sign = value < 0 && rounded !== 0 ? '-' : '';
  return `${sign}${group(intPart, sep)}${trimmed ? ',' + trimmed : ''}`;
}

export function formatHuf(value: number | undefined | null, sep = NBSP): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '–';
  return `${formatNumber(Math.round(value), 0, sep)}${sep}Ft`;
}

export function formatQuantity(value: number | undefined | null, unit: string, maxDecimals = 2, sep = NBSP): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '–';
  return `${formatNumber(value, maxDecimals, sep)}${sep}${unit}`;
}

export function formatPercent(value: number | undefined | null, sep = NBSP): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '–';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value, 1, sep)}${sep}%`;
}

/** `2026-10-08` -> `2026.10.08.` */
export function formatDate(date: string | undefined | null): string {
  if (!date) return '–';
  const [y, m, d] = date.split('-');
  return `${y}.${m}.${d}.`;
}


/**
 * Parses user input written either the Hungarian way (`1 234,5`) or the English way (`1234.5`).
 * Returns undefined for empty input and NaN for garbage.
 */
export function parseNumberInput(raw: string): number | undefined {
  const s = raw.replace(/[\s\u00A0\u202F]/g, '').replace(/(Ft|m³|m3|kWh)$/i, '');
  if (s === '') return undefined;
  // A comma is always a decimal separator; dots are thousand separators only if a comma also exists.
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return NaN;
  return Number(normalized);
}

/** `2026-10-20`, `2026-10-28` -> `2026.10.20.–2026.10.28.` (dates are always year.month.day). */
export function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)}–${formatDate(end)}`;
}

/**
 * Parses a typed date in year.month.day order (`2026.10.08.`, `2026. 10. 8.`, `2026-10-08`,
 * `20261008`) into `YYYY-MM-DD`. Returns undefined for empty input and null when invalid.
 */
export function parseDateInput(raw: string): string | undefined | null {
  const s = raw.trim();
  if (!s) return undefined;
  const m = /^(\d{4})[.\-/\s]*(\d{1,2})[.\-/\s]*(\d{1,2})\.?$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > dim) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
