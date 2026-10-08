import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURRENT_SCHEMA_VERSION,
  describeZodError,
  emptyYearFile,
  History,
  migrateYearFile,
  monthRecordSchema,
  profileUpdateSchema,
  settingsFileSchema,
  tariffSchema,
  yearFileSchema,
  type MeterId,
  type MonthRecord,
  type ProfileUpdate,
  type SettingsFile,
  type Tariff,
  type YearFile,
} from '@rezsi/shared';
import { z } from 'zod';
import { logger } from './log.js';
import { atomicWriteJson, Mutex, readJsonIfExists } from './storage.js';

const log = logger('store');

export class ValidationError extends Error {
  readonly status = 400;
}

export interface ReminderState {
  /** Date (YYYY-MM-DD) of the last notification per meter. */
  lastSent?: string;
  /** Recent sends, newest last (kept short). */
  history?: { date: string; urgent: boolean; message: string }[];
}

export interface ExportState {
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastCommit?: string;
  lastCommitMessage?: string;
  lastPushAt?: string;
  lastError?: string;
  /** Set when an error notification was sent; cleared on the next success. */
  errorNotified?: boolean;
  /** `YYYY-MM` of the last scheduled monthly export. */
  lastMonthly?: string;
}

export interface AppState {
  schemaVersion: 1;
  reminders: Partial<Record<MeterId, ReminderState>>;
  lastReminderCheck?: string;
  export: ExportState;
}

function emptyState(): AppState {
  return { schemaVersion: 1, reminders: {}, export: {} };
}

export class DataStore {
  readonly yearsDir: string;
  private readonly years = new Map<number, YearFile>();
  private settings: SettingsFile = { schemaVersion: CURRENT_SCHEMA_VERSION, tariffs: [] };
  private state: AppState = emptyState();
  private historyCache?: History;
  private readonly mutex = new Mutex();
  private readonly listeners = new Set<() => void>();
  /** Year files that could not be loaded (shown in the UI instead of being silently dropped). */
  readonly loadErrors: { file: string; error: string }[] = [];

  constructor(readonly dataDir: string) {
    this.yearsDir = join(dataDir, 'years');
  }

  async init(): Promise<void> {
    await mkdir(this.yearsDir, { recursive: true });
    for (const name of (await readdir(this.yearsDir)).sort()) {
      if (!/^\d{4}\.json$/.test(name)) continue;
      const path = join(this.yearsDir, name);
      try {
        const parsed = yearFileSchema.safeParse(migrateYearFile(await readJsonIfExists(path)));
        if (!parsed.success) throw new Error(describeZodError(parsed.error));
        if (`${parsed.data.year}.json` !== name) throw new Error(`year field ${parsed.data.year} does not match file name`);
        this.years.set(parsed.data.year, parsed.data);
      } catch (err) {
        const error = (err as Error).message;
        log.error(`Cannot load ${path}: ${error}`);
        this.loadErrors.push({ file: name, error });
      }
    }
    const settingsRaw = await readJsonIfExists(join(this.dataDir, 'settings.json'));
    if (settingsRaw !== undefined) {
      const parsed = settingsFileSchema.safeParse(settingsRaw);
      if (parsed.success) this.settings = parsed.data;
      else log.error(`Invalid settings.json, ignoring: ${describeZodError(parsed.error)}`);
    }
    const stateRaw = (await readJsonIfExists(join(this.dataDir, 'state.json'))) as Partial<AppState> | undefined;
    if (stateRaw && typeof stateRaw === 'object') {
      this.state = { ...emptyState(), ...stateRaw, export: { ...stateRaw.export }, reminders: { ...stateRaw.reminders } };
    }
    log.info(`Loaded ${this.years.size} year file(s) from ${this.yearsDir}`);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.historyCache = undefined;
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        log.warn('change listener failed', err);
      }
    }
  }

  listYears(): number[] {
    return [...this.years.keys()].sort((a, b) => a - b);
  }

  getYear(year: number): YearFile | undefined {
    return this.years.get(year);
  }

  allYears(): YearFile[] {
    return this.listYears().map((y) => this.years.get(y)!);
  }

  history(): History {
    return (this.historyCache ??= new History(this.allYears()));
  }

  private async saveYear(file: YearFile): Promise<YearFile> {
    const parsed = yearFileSchema.safeParse(file);
    if (!parsed.success) throw new ValidationError(describeZodError(parsed.error));
    await atomicWriteJson(join(this.yearsDir, `${parsed.data.year}.json`), parsed.data);
    this.years.set(parsed.data.year, parsed.data);
    this.changed();
    return parsed.data;
  }

  upsertMonth(year: number, month: number, input: unknown): Promise<YearFile> {
    return this.mutex.run(async () => {
      const parsed = monthRecordSchema.safeParse(input);
      if (!parsed.success) throw new ValidationError(describeZodError(parsed.error));
      if (parsed.data.month !== month) throw new ValidationError('A hónap nem egyezik az URL-lel.');
      const file = structuredClone(this.years.get(year) ?? emptyYearFile(year));
      const isEmpty = isEmptyRecord(parsed.data);
      file.months = file.months.filter((m) => m.month !== month);
      if (!isEmpty) file.months.push(parsed.data);
      return this.saveYear(file);
    });
  }

  setProfile(year: number, input: unknown): Promise<YearFile> {
    return this.mutex.run(async () => {
      const parsed = profileUpdateSchema.safeParse(input);
      if (!parsed.success) throw new ValidationError(describeZodError(parsed.error));
      const update: ProfileUpdate = parsed.data;
      const file = structuredClone(this.years.get(year) ?? emptyYearFile(year));
      file.gasProfile = update.gasProfile;
      const targets = update.annualTargets;
      if (targets && (targets.gas !== undefined || targets.electricity !== undefined)) file.annualTargets = targets;
      else delete file.annualTargets;
      return this.saveYear(file);
    });
  }

  /** Replaces whole year files (import). Existing files are backed up first. */
  replaceYears(files: YearFile[]): Promise<void> {
    return this.mutex.run(async () => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = join(this.dataDir, 'backup');
      for (const f of files) {
        const parsed = yearFileSchema.safeParse(f);
        if (!parsed.success) throw new ValidationError(`${f.year}: ${describeZodError(parsed.error)}`);
      }
      for (const f of files) {
        const path = join(this.yearsDir, `${f.year}.json`);
        if (existsSync(path)) {
          await mkdir(backupDir, { recursive: true });
          await copyFile(path, join(backupDir, `${f.year}-${stamp}.json`));
        }
        const parsed = yearFileSchema.parse(f);
        await atomicWriteJson(path, parsed);
        this.years.set(parsed.year, parsed);
      }
      this.changed();
    });
  }

  getTariffs(): Tariff[] {
    return this.settings.tariffs;
  }

  setTariffs(input: unknown): Promise<Tariff[]> {
    return this.mutex.run(async () => {
      const parsed = z.array(tariffSchema).safeParse(input);
      if (!parsed.success) throw new ValidationError(describeZodError(parsed.error));
      const settings = settingsFileSchema.parse({ ...this.settings, tariffs: parsed.data });
      await atomicWriteJson(join(this.dataDir, 'settings.json'), settings);
      this.settings = settings;
      return settings.tariffs;
    });
  }

  getState(): AppState {
    return this.state;
  }

  updateState(fn: (s: AppState) => void): Promise<AppState> {
    return this.mutex.run(async () => {
      const next = structuredClone(this.state);
      fn(next);
      await atomicWriteJson(join(this.dataDir, 'state.json'), next);
      this.state = next;
      return next;
    });
  }

  /** Resolves when all queued writes have finished (graceful shutdown). */
  flush(): Promise<void> {
    return this.mutex.idle();
  }
}

function isEmptyRecord(r: MonthRecord): boolean {
  return Object.keys(r.readings).length === 0 && !r.gasReported && Object.keys(r.bills).length === 0 && !r.note?.trim();
}
