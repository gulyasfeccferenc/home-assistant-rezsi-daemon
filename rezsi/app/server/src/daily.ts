import { join } from 'node:path';
import {
  dailyConsumption,
  dailyGasFileSchema,
  dailyGasReadingSchema,
  dailyReminderSlot,
  describeZodError,
  formatDate,
  formatNumber,
  formatQuantity,
  zonedParts,
  type DailyGasFile,
  type DailyGasReading,
  type Options,
} from '@rezsi/shared';
import type { HaClient } from './ha.js';
import { logger } from './log.js';
import { atomicWriteJson, Mutex, readJsonIfExists } from './storage.js';
import { ValidationError, type DataStore } from './store.js';
import type { WeatherService } from './weather.js';

const log = logger('daily-gas');

/** `2026-12-01T18:00` -> `2026.12.01. 18:00` */
const fmtAt = (at: string) => `${formatDate(at.slice(0, 10))} ${at.slice(11)}`;

/** Daily gas meter readings in /data/daily-gas.json (not part of the git export). */
export class DailyGasStore {
  private file: DailyGasFile = { schemaVersion: 1, readings: [] };
  private readonly path: string;
  private readonly mutex = new Mutex();

  constructor(dataDir: string) {
    this.path = join(dataDir, 'daily-gas.json');
  }

  async init(): Promise<void> {
    const raw = await readJsonIfExists(this.path);
    if (raw === undefined) return;
    const parsed = dailyGasFileSchema.safeParse(raw);
    if (parsed.success) this.file = parsed.data;
    else log.error(`Invalid ${this.path}, ignoring: ${describeZodError(parsed.error)}`);
  }

  readings(): DailyGasReading[] {
    return this.file.readings;
  }

  /** Adds a reading (replacing one with the same time). Meter readings must not go backwards. */
  add(input: unknown): Promise<DailyGasReading[]> {
    return this.mutex.run(async () => {
      const parsed = dailyGasReadingSchema.safeParse(input);
      if (!parsed.success) throw new ValidationError(describeZodError(parsed.error));
      const r = parsed.data;
      const others = this.file.readings.filter((x) => x.at !== r.at);
      const before = others.filter((x) => x.at < r.at).at(-1);
      const after = others.find((x) => x.at > r.at);
      if (before && r.value < before.value) {
        throw new ValidationError(`Kisebb, mint az előző leolvasás (${formatNumber(before.value, 3)} m³, ${fmtAt(before.at)}).`);
      }
      if (after && r.value > after.value) {
        throw new ValidationError(`Nagyobb, mint a későbbi leolvasás (${formatNumber(after.value, 3)} m³, ${fmtAt(after.at)}).`);
      }
      return this.save([...others, r]);
    });
  }

  remove(at: string): Promise<DailyGasReading[]> {
    return this.mutex.run(async () => {
      if (!this.file.readings.some((x) => x.at === at)) throw new ValidationError('Nincs ilyen leolvasás.');
      return this.save(this.file.readings.filter((x) => x.at !== at));
    });
  }

  private async save(readings: DailyGasReading[]): Promise<DailyGasReading[]> {
    const file = dailyGasFileSchema.parse({ schemaVersion: 1, readings });
    await atomicWriteJson(this.path, file);
    this.file = file;
    return file.readings;
  }

  flush(): Promise<void> {
    return this.mutex.idle();
  }
}

/** The evening reminder: at daily_gas_time and again at daily_gas_repeat_time, unless a reading was entered today. */
export class DailyGasReminder {
  constructor(
    private readonly daily: DailyGasStore,
    private readonly weather: WeatherService,
    private readonly store: DataStore,
    private readonly ha: HaClient,
    private readonly options: Options,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get slots(): string[] {
    return [this.options.daily_gas_time, this.options.daily_gas_repeat_time].filter(Boolean);
  }

  async run(): Promise<boolean> {
    if (!this.options.daily_gas_enabled) return false;
    const now = zonedParts(this.now());
    const readings = this.daily.readings();
    const hasToday = readings.some((r) => r.at.startsWith(now.date));
    const lastSent = this.store.getState().dailyGas?.lastSent;
    const slot = dailyReminderSlot(now, this.slots, hasToday, lastSent);
    if (slot === undefined) return false;

    const parts = ['Ma még nincs rögzítve a napi gázóra-állás.'];
    const last = readings.at(-1);
    if (last) parts.push(`Utolsó: ${fmtAt(last.at)} (${formatNumber(last.value, 3)} m³).`);
    // The latest day with readings on both sides (yesterday is only complete after today's reading).
    const day = dailyConsumption(readings, this.weather.temperatures(), this.options.heating_base_temperature)
      .days.filter((d) => d.complete)
      .at(-1);
    if (day) {
      parts.push(
        `${formatDate(day.date)}: ${formatQuantity(day.consumption, 'm³', 2)}` +
          (day.meanTemp !== undefined ? `, átlag ${formatNumber(day.meanTemp, 1)} °C` : '') +
          '.',
      );
    }
    const panel = await this.ha.getPanelPath();
    try {
      await this.ha.notify(this.options.notify_service, {
        title: 'RezsiDaemon – napi gáz',
        message: parts.join(' '),
        data: { tag: 'rezsi-daily-gas', group: 'rezsi', ...(panel ? { url: `${panel}/napi`, clickAction: `${panel}/napi` } : {}) },
      });
    } catch (err) {
      log.error('Sending the daily gas reminder failed', err);
      return false;
    }
    await this.store.updateState((s) => {
      s.dailyGas = { ...s.dailyGas, lastSent: { date: now.date, slot } };
    });
    return true;
  }
}
