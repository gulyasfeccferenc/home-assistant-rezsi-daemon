import { History, monthlyWindow, suggestGasReport, type GasSuggestion } from './calc.js';
import { METER_IDS, type MeterId } from './categories.js';
import type { CalcConfig } from './config.js';
import { addDays, diffDays, parseIsoDate } from './dates.js';
import { formatDate, formatMonthDayRange, formatQuantity } from './format.js';

export type DueStatus = 'ok' | 'upcoming' | 'due' | 'overdue' | 'unknown';

export interface MeterDue {
  meter: MeterId;
  status: DueStatus;
  /** True when the reading this reminder is about has been entered. */
  satisfied: boolean;
  windowStart?: string;
  windowEnd?: string;
  /** Month the entry form should open for. */
  year: number;
  month: number;
  lastReadingDate?: string;
  /** Gas only. */
  suggestion?: GasSuggestion;
  /** Gas only: latest actual reading minus latest reported reading. */
  deficit?: number;
}

function statusFor(today: string, start: string, end: string, satisfied: boolean): DueStatus {
  if (satisfied) return 'ok';
  if (today < start) return 'upcoming';
  if (today <= end) return 'due';
  return 'overdue';
}

export function meterDue(history: History, meter: MeterId, today: string, cfg: CalcConfig): MeterDue {
  const { year, month } = parseIsoDate(today);
  if (meter === 'water') {
    const last = history.latest('water');
    if (!last) return { meter, status: 'unknown', satisfied: false, year, month };
    const windowStart = addDays(last.date, cfg.waterIntervalDays);
    const windowEnd = addDays(windowStart, cfg.waterWindowDays - 1);
    // A newer reading moves the window, so the current window is never satisfied by definition.
    const status: DueStatus = today < windowStart ? 'ok' : today <= windowEnd ? 'due' : 'overdue';
    return { meter, status, satisfied: status === 'ok', windowStart, windowEnd, year, month, lastReadingDate: last.date };
  }

  const window = meter === 'gas' ? cfg.gasWindow : cfg.electricityWindow;
  const { start, end } = monthlyWindow(year, month, window);
  const rec = history.record(year, month);
  const satisfied = meter === 'gas' ? !!(rec?.gasReported && rec.readings.gas) : !!rec?.readings.electricity;
  const due: MeterDue = {
    meter,
    status: statusFor(today, start, end, satisfied),
    satisfied,
    windowStart: start,
    windowEnd: end,
    year,
    month,
    lastReadingDate: history.latest(meter)?.date,
  };
  if (meter === 'gas') {
    due.suggestion = suggestGasReport(history, year, month);
    const actual = history.latest('gas')?.value;
    const reported = history.latest('gasReported')?.value;
    if (actual !== undefined && reported !== undefined) due.deficit = actual - reported;
  }
  return due;
}

export function allMetersDue(history: History, today: string, cfg: CalcConfig): MeterDue[] {
  return METER_IDS.map((m) => meterDue(history, m, today, cfg));
}

export interface SendDecision {
  send: boolean;
  urgent: boolean;
}

/**
 * Whether a reminder has to go out today: on the first day of the window, then every
 * `repeatEveryDays`, and on the last day (urgent). At most one per meter per day.
 * Monthly meters stop when their window closes; water keeps reminding while overdue.
 */
export function decideSend(due: MeterDue, today: string, lastSent: string | undefined, cfg: CalcConfig): SendDecision {
  const no = { send: false, urgent: false };
  if (!due.windowStart || !due.windowEnd) return no;
  if (due.status !== 'due' && due.status !== 'overdue') return no;
  if (due.status === 'overdue' && due.meter !== 'water') return no;
  if (lastSent === today) return no;
  const urgent = today === due.windowEnd;
  if (today === due.windowStart || urgent) return { send: true, urgent };
  if (lastSent && lastSent >= due.windowStart) {
    return { send: diffDays(lastSent, today) >= cfg.repeatEveryDays, urgent: false };
  }
  // Nothing sent in this window yet (e.g. the add-on was down on the first day): catch up.
  return { send: true, urgent: false };
}

export interface ReminderText {
  title: string;
  message: string;
}

export function reminderText(due: MeterDue, urgent: boolean): ReminderText {
  const prefix = urgent ? 'Utolsó nap! ' : '';
  switch (due.meter) {
    case 'gas': {
      const parts = [`${prefix}Gáz diktálás: ${formatMonthDayRange(due.windowStart!, due.windowEnd!)}.`];
      if (due.suggestion) parts.push(`Javasolt érték: ${formatQuantity(due.suggestion.value, 'm³', 0)}`);
      if (due.deficit !== undefined) parts.push(`Nem diktált: ${formatQuantity(due.deficit, 'm³', 0)}`);
      return { title: 'Rezsi – gáz', message: parts.join(' ') };
    }
    case 'electricity':
      return {
        title: 'Rezsi – villany',
        message: `${prefix}Villanyóra leolvasás esedékes (${formatMonthDayRange(due.windowStart!, due.windowEnd!)}.)`,
      };
    case 'water':
      return {
        title: 'Rezsi – víz',
        message:
          due.status === 'overdue'
            ? `Vízóra leolvasás késésben (utolsó: ${formatDate(due.lastReadingDate)})`
            : `${prefix}Vízóra leolvasás esedékes`,
      };
  }
}
