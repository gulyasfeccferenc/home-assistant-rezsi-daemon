import { calcConfigFromOptions, computeYear, METERS, zonedParts, type Options } from '@rezsi/shared';
import type { HaClient } from './ha.js';
import { logger } from './log.js';
import type { ReminderService } from './reminders.js';
import type { DataStore } from './store.js';

const log = logger('entities');

/**
 * Publishes helper entities via POST /api/states. These are not persisted by Home Assistant,
 * so they are re-published at startup, after every change and after each daily check.
 */
export class EntityPublisher {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly store: DataStore,
    private readonly ha: HaClient,
    private readonly reminders: ReminderService,
    private readonly options: Options,
  ) {}

  get enabled(): boolean {
    return this.options.publish_entities && this.ha.configured;
  }

  schedule(): void {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.publish(), 2000);
  }

  async publish(): Promise<void> {
    if (!this.enabled) return;
    try {
      const { year, month, date } = zonedParts();
      for (const due of this.reminders.due()) {
        await this.ha.setState(`binary_sensor.rezsi_${due.meter}_due`, due.status === 'due' || due.status === 'overdue' ? 'on' : 'off', {
          friendly_name: `Rezsi ${METERS[due.meter].label.toLowerCase()} leolvasás esedékes`,
          icon: 'mdi:counter',
          status: due.status,
          window_start: due.windowStart ?? null,
          window_end: due.windowEnd ?? null,
          suggested_report: due.suggestion?.value ?? null,
        });
      }
      const computed = computeYear(this.store.history(), year, calcConfigFromOptions(this.options), date);
      const money = { unit_of_measurement: 'Ft', device_class: 'monetary', icon: 'mdi:cash' };
      await this.ha.setState('sensor.rezsi_month_total', computed.months[month - 1].total ?? 0, {
        ...money,
        friendly_name: 'Rezsi havi összesen',
        year,
        month,
      });
      const unpaid = this.store
        .allYears()
        .flatMap((f) => f.months.flatMap((r) => Object.values(r.bills)))
        .reduce((sum, b) => sum + (b && !b.paid ? b.amount : 0), 0);
      await this.ha.setState('sensor.rezsi_unpaid_total', unpaid, {
        ...money,
        friendly_name: 'Rezsi kifizetetlen',
      });
    } catch (err) {
      log.warn('Publishing entities failed', err);
    }
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}
