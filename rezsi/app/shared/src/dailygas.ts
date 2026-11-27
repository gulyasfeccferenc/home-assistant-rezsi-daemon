import { z } from 'zod';
import { addDays, isValidIsoDate, TIME_ZONE } from './dates.js';

// Daily gas meter readings (separate from the monthly readings): readings at arbitrary times,
// consumption split onto calendar days in proportion to time, joined with daily mean temperatures.

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'ÉÉÉÉ-HH-NNTÓÓ:PP')
  .refine((s) => isValidIsoDate(s.slice(0, 10)), 'Érvénytelen dátum');

export const dailyGasReadingSchema = z
  .object({
    /** Local time in Europe/Budapest, `YYYY-MM-DDTHH:mm`. */
    at: localDateTime,
    value: z.number().finite().nonnegative(),
    note: z.string().max(500).optional(),
  })
  .strict();
export type DailyGasReading = z.infer<typeof dailyGasReadingSchema>;

export const dailyGasFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    readings: z.array(dailyGasReadingSchema).max(20000),
  })
  .strict()
  .transform((f) => ({ ...f, readings: [...f.readings].sort((a, b) => a.at.localeCompare(b.at)) }));
export type DailyGasFile = z.output<typeof dailyGasFileSchema>;

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Epoch milliseconds of a local `YYYY-MM-DDTHH:mm` (or `YYYY-MM-DD` = midnight) in the given zone. */
export function zonedToEpoch(local: string, timeZone = TIME_ZONE): number {
  const [d, t = '00:00'] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let ms = guess - tzOffsetMs(guess, timeZone);
  // Second pass settles readings near a DST change.
  ms = guess - tzOffsetMs(ms, timeZone);
  return ms;
}

export interface DailyGasDay {
  date: string;
  /** m³ allocated to this calendar day. */
  consumption: number;
  /** Share of the day (0..1) covered by intervals between readings. */
  coverage: number;
  /** Both neighbouring readings exist: the day's value is final. */
  complete: boolean;
  /** Longest reading interval (hours) that contributed; long gaps are spread evenly over time. */
  maxIntervalHours: number;
  meanTemp?: number;
  /** Heating degree days: max(0, base − mean temperature). */
  hdd?: number;
}

export interface DailyGasProblem {
  at: string;
  message: string;
}

/**
 * Splits the consumption between consecutive readings onto calendar days (Europe/Budapest) in
 * proportion to the time each day spends in the interval. A reading in the morning and one late in
 * the evening are therefore both handled: each day gets the share of every interval it overlaps.
 */
export function dailyConsumption(
  readings: DailyGasReading[],
  temps: Record<string, number> = {},
  baseTemperature = 16,
): { days: DailyGasDay[]; problems: DailyGasProblem[] } {
  const sorted = [...readings].sort((a, b) => a.at.localeCompare(b.at));
  const problems: DailyGasProblem[] = [];
  const acc = new Map<string, { consumption: number; covered: number; maxH: number }>();
  for (let i = 1; i < sorted.length; i++) {
    const r0 = sorted[i - 1];
    const r1 = sorted[i];
    const t0 = zonedToEpoch(r0.at);
    const t1 = zonedToEpoch(r1.at);
    const delta = r1.value - r0.value;
    if (t1 <= t0) continue;
    if (delta < 0) {
      problems.push({ at: r1.at, message: `Kisebb, mint az előző leolvasás (${r0.value} → ${r1.value}).` });
      continue;
    }
    const rate = delta / (t1 - t0);
    const hours = (t1 - t0) / 3_600_000;
    for (let day = r0.at.slice(0, 10); ; day = addDays(day, 1)) {
      const dayStart = zonedToEpoch(day);
      const dayEnd = zonedToEpoch(addDays(day, 1));
      if (dayStart >= t1) break;
      const overlap = Math.min(t1, dayEnd) - Math.max(t0, dayStart);
      if (overlap > 0) {
        const a = acc.get(day) ?? { consumption: 0, covered: 0, maxH: 0 };
        a.consumption += rate * overlap;
        a.covered += overlap / (dayEnd - dayStart);
        a.maxH = Math.max(a.maxH, hours);
        acc.set(day, a);
      }
    }
  }
  const days = [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, a]): DailyGasDay => {
      const coverage = Math.min(1, a.covered);
      const meanTemp = temps[date];
      return {
        date,
        consumption: a.consumption,
        coverage,
        complete: coverage > 0.999,
        maxIntervalHours: a.maxH,
        ...(meanTemp !== undefined ? { meanTemp, hdd: Math.max(0, baseTemperature - meanTemp) } : {}),
      };
    });
  return { days, problems };
}

export interface Regression {
  /** m³/day change per +1 °C (negative while heating). */
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

/** Least-squares line of daily consumption against mean temperature (complete days only). */
export function temperatureRegression(days: DailyGasDay[], minDays = 5): Regression | undefined {
  const pts = days.filter((d) => d.complete && d.meanTemp !== undefined).map((d) => [d.meanTemp!, d.consumption] as const);
  const n = pts.length;
  if (n < minDays) return undefined;
  const mx = pts.reduce((s, [x]) => s + x, 0) / n;
  const my = pts.reduce((s, [, y]) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return undefined;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy), n };
}

export interface WeeklyIntensity {
  /** Monday of the week. */
  week: string;
  consumption: number;
  hdd: number;
  /** m³ per heating degree day (includes hot water and cooking). */
  perHdd?: number;
  days: number;
}

function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

export function weeklyIntensity(days: DailyGasDay[]): WeeklyIntensity[] {
  const weeks = new Map<string, WeeklyIntensity>();
  for (const d of days) {
    if (!d.complete || d.hdd === undefined) continue;
    const key = mondayOf(d.date);
    const w = weeks.get(key) ?? { week: key, consumption: 0, hdd: 0, days: 0 };
    w.consumption += d.consumption;
    w.hdd += d.hdd;
    w.days += 1;
    weeks.set(key, w);
  }
  return [...weeks.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => ({ ...w, perHdd: w.hdd > 0 ? w.consumption / w.hdd : undefined }));
}

/** Daily mean temperatures from Open-Meteo hourly data; only days with a full set of hours. */
export function dailyMeansFromHourly(time: string[], temps: (number | null)[], before: string): Record<string, number> {
  const byDay = new Map<string, number[]>();
  time.forEach((t, i) => {
    const v = temps[i];
    if (v === null || v === undefined) return;
    const day = t.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(v);
    byDay.set(day, list);
  });
  const out: Record<string, number> = {};
  for (const [day, list] of byDay) {
    // 23–25 hours depending on DST; earlier than `before` (today) so the day is over.
    if (day < before && list.length >= 23) out[day] = Math.round((list.reduce((s, v) => s + v, 0) / list.length) * 10) / 10;
  }
  return out;
}

/**
 * Which daily reminder to send now, if any: the latest slot time that has passed today, unless a
 * reading was already entered today or that slot (or a later one) was already sent today.
 */
export function dailyReminderSlot(
  now: { date: string; hour: number; minute: number },
  slots: string[],
  hasReadingToday: boolean,
  lastSent: { date: string; slot: number } | undefined,
): number | undefined {
  if (hasReadingToday) return undefined;
  const minutes = now.hour * 60 + now.minute;
  let due: number | undefined;
  slots.forEach((s, i) => {
    if (!s) return;
    const [h, m] = s.split(':').map(Number);
    if (minutes >= h * 60 + m) due = i;
  });
  if (due === undefined) return undefined;
  if (lastSent && lastSent.date === now.date && lastSent.slot >= due) return undefined;
  return due;
}
