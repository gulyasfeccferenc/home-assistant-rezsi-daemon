import { Cron } from 'croner';
import { TIME_ZONE, zonedParts, type Options } from '@rezsi/shared';
import type { EntityPublisher } from './entities.js';
import type { ExportService } from './export/index.js';
import { logger } from './log.js';
import type { ReminderService } from './reminders.js';
import type { DataStore } from './store.js';

const log = logger('scheduler');

function cronAt(time: string, dayOfMonth = '*'): string {
  const [h, m] = time.split(':').map(Number);
  return `${m} ${h} ${dayOfMonth} * *`;
}

/** In-process jobs in Europe/Budapest. Persistent state lives in state.json (via the services). */
export class Scheduler {
  private jobs: Cron[] = [];

  constructor(
    private readonly options: Options,
    private readonly store: DataStore,
    private readonly reminders: ReminderService,
    private readonly exporter: ExportService,
    private readonly entities: EntityPublisher,
  ) {}

  start(): void {
    const protect = true; // never overlap runs of the same job
    this.jobs.push(
      new Cron(cronAt(this.options.reminder_time), { timezone: TIME_ZONE, protect, name: 'reminders' }, async () => {
        await this.runReminders(false);
      }),
    );
    if (this.options.export_enabled) {
      this.jobs.push(
        new Cron(cronAt(this.options.export_time, String(this.options.export_day)), { timezone: TIME_ZONE, protect, name: 'export' }, async () => {
          await this.exporter.run('monthly').catch((err) => log.error('Monthly export failed', err));
        }),
      );
    }
    for (const j of this.jobs) log.info(`Job "${j.name}" next run: ${j.nextRun()?.toISOString() ?? 'never'}`);

    // Startup: catch up without resending.
    setTimeout(() => void this.startup(), 3000);
  }

  private async runReminders(startup: boolean): Promise<void> {
    try {
      const sent = await this.reminders.run({ startup });
      if (sent.length) log.info(`Reminders sent: ${sent.map((s) => s.meter).join(', ')}`);
    } catch (err) {
      log.error('Reminder check failed', err);
    }
    await this.entities.publish();
  }

  private async startup(): Promise<void> {
    await this.runReminders(true);
    if (!this.options.export_enabled) return;
    // Missed monthly export (add-on was down at the scheduled time)?
    const now = zonedParts();
    const [h, m] = this.options.export_time.split(':').map(Number);
    const due =
      now.day > this.options.export_day ||
      (now.day === this.options.export_day && now.hour * 60 + now.minute >= h * 60 + m);
    const month = now.date.slice(0, 7);
    if (due && this.store.getState().export.lastMonthly !== month) {
      log.info('Running missed monthly export');
      await this.exporter.run('monthly').catch((err) => log.error('Catch-up export failed', err));
    }
  }

  stop(): void {
    for (const j of this.jobs) j.stop();
    this.jobs = [];
  }
}
