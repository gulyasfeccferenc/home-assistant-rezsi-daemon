import {
  allMetersDue,
  calcConfigFromOptions,
  decideSend,
  pad2,
  reminderText,
  zonedParts,
  METERS,
  type MeterDue,
  type Options,
} from '@rezsi/shared';
import type { HaClient } from './ha.js';
import { logger } from './log.js';
import type { DataStore } from './store.js';

const log = logger('reminders');

export interface SentReminder {
  meter: MeterDue['meter'];
  urgent: boolean;
  message: string;
}

/** Path inside the add-on UI that opens the entry form for a month. */
export function entryPath(year: number, month: number): string {
  return `rogzites/${year}-${pad2(month)}`;
}

export class ReminderService {
  constructor(
    private readonly store: DataStore,
    private readonly ha: HaClient,
    private readonly options: Options,
    private readonly now: () => Date = () => new Date(),
  ) {}

  due(): MeterDue[] {
    return allMetersDue(this.store.history(), zonedParts(this.now()).date, calcConfigFromOptions(this.options));
  }

  /**
   * Daily check. At startup it only catches up (never before the configured reminder time),
   * and the per-meter `lastSent` date in state.json prevents duplicates after a restart.
   */
  async run({ startup = false } = {}): Promise<SentReminder[]> {
    const parts = zonedParts(this.now());
    const today = parts.date;
    const cfg = calcConfigFromOptions(this.options);
    if (startup) {
      const [h, m] = this.options.reminder_time.split(':').map(Number);
      if (parts.hour * 60 + parts.minute < h * 60 + m) {
        log.info(`Startup check: before ${this.options.reminder_time}, not sending`);
        return [];
      }
    }
    const sent: SentReminder[] = [];
    for (const due of allMetersDue(this.store.history(), today, cfg)) {
      const lastSent = this.store.getState().reminders[due.meter]?.lastSent;
      const decision = decideSend(due, today, lastSent, cfg);
      log.debug(`${due.meter}: ${due.status}, last sent ${lastSent ?? '-'}, send=${decision.send}`);
      if (!decision.send) continue;
      const text = reminderText(due, decision.urgent);
      try {
        await this.ha.notify(this.options.notify_service, {
          title: text.title,
          message: text.message,
          data: await this.notificationData(due, decision.urgent),
        });
      } catch (err) {
        log.error(`Sending ${due.meter} reminder failed`, err);
        continue;
      }
      await this.store.updateState((s) => {
        const r = (s.reminders[due.meter] ??= {});
        r.lastSent = today;
        r.history = [...(r.history ?? []), { date: today, urgent: decision.urgent, message: text.message }].slice(-20);
      });
      sent.push({ meter: due.meter, urgent: decision.urgent, message: text.message });
    }
    await this.store.updateState((s) => {
      s.lastReminderCheck = this.now().toISOString();
    });
    return sent;
  }

  private async notificationData(due: MeterDue, urgent: boolean): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = { tag: `rezsi-${due.meter}`, group: 'rezsi' };
    const panel = await this.ha.getPanelPath();
    if (panel) {
      const path = `${panel}/${entryPath(due.year, due.month)}`;
      data.url = path; // iOS companion app
      data.clickAction = path; // Android companion app
    }
    if (urgent) data.push = { 'interruption-level': 'time-sensitive' };
    return data;
  }

  async sendTest(): Promise<void> {
    const panel = await this.ha.getPanelPath();
    await this.ha.notify(this.options.notify_service, {
      title: 'Rezsi – teszt',
      message: `Teszt értesítés (${Object.values(METERS).map((m) => m.label).join(', ')} emlékeztetők).`,
      data: { tag: 'rezsi-test', group: 'rezsi', ...(panel ? { url: panel, clickAction: panel } : {}) },
    });
  }
}
