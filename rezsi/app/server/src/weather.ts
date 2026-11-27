import { join } from 'node:path';
import { addDays, dailyMeansFromHourly, diffDays, TIME_ZONE, zonedParts, type Options } from '@rezsi/shared';
import type { HaClient } from './ha.js';
import { logger } from './log.js';
import { atomicWriteJson, Mutex, readJsonIfExists } from './storage.js';

const log = logger('weather');

export interface WeatherCache {
  schemaVersion: 1;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  /** Daily mean temperature (°C) of finished days. */
  days: Record<string, number>;
  lastFetchAt?: string;
  lastError?: string;
}

export interface WeatherStatus {
  enabled: boolean;
  source: 'Open-Meteo';
  latitude?: number;
  longitude?: number;
  locationName?: string;
  lastFetchAt?: string;
  lastError?: string;
}

const STALE_MS = 3 * 3600_000;

/**
 * Daily mean outdoor temperatures from Open-Meteo (free, no API key) for the Home Assistant
 * location (or the weather_latitude/longitude options). Hourly values are averaged per local day
 * and cached in /data/weather.json, so each day is fetched only until it is complete.
 */
export class WeatherService {
  private cache: WeatherCache = { schemaVersion: 1, days: {} };
  private readonly path: string;
  private readonly mutex = new Mutex();

  constructor(
    dataDir: string,
    private readonly options: Options,
    private readonly ha: HaClient,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.path = join(dataDir, 'weather.json');
  }

  async init(): Promise<void> {
    const raw = (await readJsonIfExists(this.path)) as Partial<WeatherCache> | undefined;
    if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
      this.cache = { ...raw, schemaVersion: 1, days: { ...raw.days } };
    }
  }

  temperatures(): Record<string, number> {
    return this.cache.days;
  }

  status(): WeatherStatus {
    const { latitude, longitude, locationName, lastFetchAt, lastError } = this.cache;
    return { enabled: this.options.weather_enabled, source: 'Open-Meteo', latitude, longitude, locationName, lastFetchAt, lastError };
  }

  private async location(): Promise<{ latitude: number; longitude: number; name?: string } | undefined> {
    const o = this.options;
    if (o.weather_latitude !== undefined && o.weather_longitude !== undefined) {
      return { latitude: o.weather_latitude, longitude: o.weather_longitude };
    }
    const cfg = await this.ha.getCoreConfig();
    if (cfg?.latitude !== undefined && cfg.longitude !== undefined) {
      return { latitude: cfg.latitude, longitude: cfg.longitude, name: cfg.location_name };
    }
    return undefined;
  }

  /** Refreshes when the last fetch is older than 3 hours (or never happened). */
  refreshIfStale(earliestNeeded?: string): Promise<void> {
    const last = this.cache.lastFetchAt ? Date.parse(this.cache.lastFetchAt) : 0;
    if (this.now().getTime() - last < STALE_MS && !this.missing(earliestNeeded)) return Promise.resolve();
    return this.refresh(earliestNeeded);
  }

  private missing(earliestNeeded?: string): boolean {
    if (!earliestNeeded) return false;
    const today = zonedParts(this.now()).date;
    for (let d = earliestNeeded; d < today; d = addDays(d, 1)) if (this.cache.days[d] === undefined) return true;
    return false;
  }

  refresh(earliestNeeded?: string): Promise<void> {
    return this.mutex.run(async () => {
      if (!this.options.weather_enabled) return;
      const today = zonedParts(this.now()).date;
      try {
        const loc = await this.location();
        if (!loc) throw new Error('Nincs hely beállítva (Home Assistant hely vagy weather_latitude/longitude).');
        // Open-Meteo's forecast API serves up to 92 past days.
        const since = earliestNeeded ?? addDays(today, -7);
        const pastDays = Math.min(92, Math.max(3, diffDays(since, today) + 1));
        const url =
          'https://api.open-meteo.com/v1/forecast' +
          `?latitude=${loc.latitude.toFixed(4)}&longitude=${loc.longitude.toFixed(4)}` +
          `&hourly=temperature_2m&timezone=${encodeURIComponent(TIME_ZONE)}&past_days=${pastDays}&forecast_days=1`;
        const res = await this.fetchFn(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
        const body = (await res.json()) as { hourly?: { time?: string[]; temperature_2m?: (number | null)[] } };
        if (!body.hourly?.time || !body.hourly.temperature_2m) throw new Error('Open-Meteo: váratlan válasz');
        const means = dailyMeansFromHourly(body.hourly.time, body.hourly.temperature_2m, today);
        const moved = this.cache.latitude !== loc.latitude || this.cache.longitude !== loc.longitude;
        this.cache = {
          schemaVersion: 1,
          latitude: loc.latitude,
          longitude: loc.longitude,
          locationName: loc.name ?? this.cache.locationName,
          // A changed location invalidates temperatures that were cached for the old one.
          days: Object.fromEntries(Object.entries({ ...(moved ? {} : this.cache.days), ...means }).sort(([a], [b]) => a.localeCompare(b))),
          lastFetchAt: this.now().toISOString(),
        };
        log.info(`Fetched temperatures for ${Object.keys(means).length} day(s) (${loc.latitude}, ${loc.longitude})`);
      } catch (err) {
        this.cache = { ...this.cache, lastFetchAt: this.now().toISOString(), lastError: (err as Error).message };
        log.warn(`Temperature fetch failed: ${(err as Error).message}`);
      }
      await atomicWriteJson(this.path, this.cache);
    });
  }
}
