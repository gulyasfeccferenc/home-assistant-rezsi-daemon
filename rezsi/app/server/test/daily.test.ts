import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { DailyGasReminder, DailyGasStore } from '../src/daily.js';
import { ExportService } from '../src/export/index.js';
import { ReminderService } from '../src/reminders.js';
import { ValidationError } from '../src/store.js';
import { WeatherService } from '../src/weather.js';
import { FakeHa, opts, seededStore, tempDir, testEnv } from './helpers.js';

/** Shape of an Open-Meteo /v1/forecast response with hourly=temperature_2m (abridged to what we read). */
function openMeteo(days: { date: string; temps: number[] }[]) {
  const time: string[] = [];
  const temperature_2m: number[] = [];
  for (const d of days) {
    d.temps.forEach((t, h) => {
      time.push(`${d.date}T${String(h).padStart(2, '0')}:00`);
      temperature_2m.push(t);
    });
  }
  return {
    latitude: 47.6,
    longitude: 19.600002,
    generationtime_ms: 0.05,
    utc_offset_seconds: 3600,
    timezone: 'Europe/Budapest',
    timezone_abbreviation: 'GMT+1',
    elevation: 119,
    hourly_units: { time: 'iso8601', temperature_2m: '°C' },
    hourly: { time, temperature_2m },
  };
}

const flat = (t: number) => Array(24).fill(t) as number[];

function fakeFetch(payload: unknown, calls: string[], status = 200): typeof fetch {
  return (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
}

describe('DailyGasStore', () => {
  it('adds, replaces, rejects backwards readings, removes', async () => {
    const dir = await tempDir();
    const s = new DailyGasStore(dir);
    await s.init();
    await s.add({ at: '2026-12-01T18:00', value: 8500.125 });
    await s.add({ at: '2026-12-02T07:30', value: 8505.5 });
    await s.add({ at: '2026-12-02T07:30', value: 8505.75 }); // same time: replaced
    await expect(s.add({ at: '2026-12-03T18:00', value: 8500 })).rejects.toThrow(/Kisebb/);
    await expect(s.add({ at: '2026-12-01T20:00', value: 8600 })).rejects.toThrow(/Nagyobb/);
    await expect(s.add({ at: '2026-12-01 20:00', value: 1 })).rejects.toBeInstanceOf(ValidationError);
    const reloaded = new DailyGasStore(dir);
    await reloaded.init();
    expect(reloaded.readings()).toEqual([
      { at: '2026-12-01T18:00', value: 8500.125 },
      { at: '2026-12-02T07:30', value: 8505.75 },
    ]);
    await reloaded.remove('2026-12-01T18:00');
    expect(reloaded.readings()).toHaveLength(1);
    await expect(reloaded.remove('nope')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('WeatherService', () => {
  it('fetches the HA location, averages complete days, caches them', async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const payload = openMeteo([
      { date: '2026-12-01', temps: flat(1) },
      { date: '2026-12-02', temps: [...flat(0).slice(0, 12), ...flat(4).slice(0, 12)] },
      { date: '2026-12-03', temps: flat(9) }, // today: not complete yet
    ]);
    const now = () => new Date('2026-12-03T15:00:00Z');
    const w = new WeatherService(dir, opts(), new FakeHa(), fakeFetch(payload, calls), now);
    await w.init();
    await w.refreshIfStale('2026-12-01');
    expect(w.temperatures()).toEqual({ '2026-12-01': 1, '2026-12-02': 2 });
    expect(calls[0]).toContain('latitude=47.6086&longitude=19.6016');
    expect(calls[0]).toContain('timezone=Europe%2FBudapest');
    expect(calls[0]).toContain('past_days=3');
    expect(w.status()).toMatchObject({ locationName: 'Tura', lastError: undefined });

    // Cached and fresh: no new request.
    const again = new WeatherService(dir, opts(), new FakeHa(), fakeFetch(payload, calls), now);
    await again.init();
    await again.refreshIfStale('2026-12-01');
    expect(calls).toHaveLength(1);
    expect(again.temperatures()['2026-12-01']).toBe(1);
  });

  it('records errors and respects the option overrides and the switch', async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const w = new WeatherService(dir, opts({ weather_latitude: 47.5, weather_longitude: 19 }), new FakeHa(), fakeFetch({}, calls, 500));
    await w.refresh();
    expect(calls[0]).toContain('latitude=47.5000&longitude=19.0000');
    expect(w.status().lastError).toBe('Open-Meteo HTTP 500');
    const off = new WeatherService(dir, opts({ weather_enabled: false }), new FakeHa(), fakeFetch({}, calls));
    await off.refresh();
    expect(calls).toHaveLength(1);
  });
});

describe('DailyGasReminder', () => {
  it('reminds at 18:00, repeats at 21:00, stays quiet once a reading exists', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    const daily = new DailyGasStore(dir);
    await daily.init();
    await daily.add({ at: '2026-12-01T18:00', value: 100 });
    await daily.add({ at: '2026-12-02T18:00', value: 112.5 });
    const ha = new FakeHa();
    const weather = new WeatherService(dir, opts(), ha, fakeFetch(openMeteo([{ date: '2026-12-02', temps: flat(2) }]), []), () => new Date('2026-12-03T10:00:00Z'));
    await weather.refresh('2026-12-02');
    const at = (iso: string) => new DailyGasReminder(daily, weather, store, ha, opts(), () => new Date(iso));

    expect(await at('2026-12-03T16:59:00Z').run()).toBe(false); // 17:59 Budapest
    expect(await at('2026-12-03T17:00:00Z').run()).toBe(true); // 18:00
    expect(await at('2026-12-03T18:30:00Z').run()).toBe(false); // already sent
    expect(await at('2026-12-03T20:00:00Z').run()).toBe(true); // 21:00 repeat
    expect(ha.sent).toHaveLength(2);
    expect(ha.sent[0].payload).toMatchObject({
      title: 'RezsiDaemon – napi gáz',
      data: { tag: 'rezsi-daily-gas', url: '/abcd1234_rezsi/napi' },
    });
    expect(ha.sent[0].payload.message).toContain('Ma még nincs rögzítve');

    // Next day: a reading is entered in the morning -> no reminder in the evening.
    await daily.add({ at: '2026-12-04T07:15', value: 125 });
    expect(await at('2026-12-04T17:00:00Z').run()).toBe(false);
    expect(await new DailyGasReminder(daily, weather, store, ha, opts({ daily_gas_enabled: false }), () => new Date('2026-12-05T17:00:00Z')).run()).toBe(false);
  });

  it('mentions the last reading and the latest complete day', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    const daily = new DailyGasStore(dir);
    await daily.init();
    await daily.add({ at: '2026-12-01T00:00', value: 100 });
    await daily.add({ at: '2026-12-03T00:00', value: 124 });
    const ha = new FakeHa();
    const weather = new WeatherService(dir, opts(), ha, fakeFetch(openMeteo([{ date: '2026-12-02', temps: flat(-1.5) }]), []), () => new Date('2026-12-03T10:00:00Z'));
    await weather.refresh('2026-12-02');
    await new DailyGasReminder(daily, weather, store, ha, opts(), () => new Date('2026-12-04T17:05:00Z')).run();
    expect(ha.sent[0].payload.message).toBe(
      'Ma még nincs rögzítve a napi gázóra-állás. Utolsó: 2026.12.03. 00:00 (124 m³). 2026.12.02.: 12\u00A0m³, átlag -1,5 °C.',
    );
  });
});

describe('daily API', () => {
  it('lists, adds and deletes readings with temperatures', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    const ha = new FakeHa();
    const o = opts();
    const daily = new DailyGasStore(dir);
    await daily.init();
    const weather = new WeatherService(dir, o, ha, fakeFetch(openMeteo([]), []));
    const app = createApp({
      env: testEnv(dir),
      options: o,
      store,
      reminders: new ReminderService(store, ha, o),
      exporter: new ExportService(store, ha, o, join(dir, 'export')),
      version: 'test',
      daily: { store: daily, weather },
    });
    const post = (body: unknown) => app.request('/api/daily', { method: 'POST', body: JSON.stringify(body) });
    expect((await post({ at: '2026-12-01T18:00', value: 10.5 })).status).toBe(200);
    expect((await post({ at: '2026-12-02T18:00', value: 9 })).status).toBe(400);
    const list = (await (await app.request('/api/daily')).json()) as { readings: unknown[]; baseTemperature: number; reminder: unknown };
    expect(list.readings).toEqual([{ at: '2026-12-01T18:00', value: 10.5 }]);
    expect(list.baseTemperature).toBe(16);
    expect(list.reminder).toEqual({ enabled: true, times: ['18:00', '21:00'] });
    const del = await app.request('/api/daily?at=2026-12-01T18:00', { method: 'DELETE' });
    expect(((await del.json()) as { readings: unknown[] }).readings).toEqual([]);
  });
});
