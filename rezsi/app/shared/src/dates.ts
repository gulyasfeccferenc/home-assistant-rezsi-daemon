// Calendar helpers. All dates are plain `YYYY-MM-DD` strings in Europe/Budapest;
// arithmetic is done in UTC so that the host time zone never matters.

export const TIME_ZONE = 'Europe/Budapest';

export interface YearMonth {
  year: number;
  month: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(value);
  if (!m) throw new Error(`Invalid date: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUtcMs(date: string): number {
  const { year, month, day } = parseIsoDate(date);
  return Date.UTC(year, month - 1, day);
}

export function addDays(date: string, days: number): string {
  const d = new Date(toUtcMs(date) + days * 86_400_000);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

/** Calendar date and time of `now` in the given time zone. */
export function zonedParts(now: Date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return { year, month, day, hour: get('hour'), minute: get('minute'), date: isoDate(year, month, day) };
}

export function today(now: Date = new Date(), timeZone = TIME_ZONE): string {
  return zonedParts(now, timeZone).date;
}

/** Linear month index, handy for comparing and spreading across year boundaries. */
export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function fromMonthIndex(index: number): YearMonth {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function compareIsoDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
