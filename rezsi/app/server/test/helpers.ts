import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultOptions, type Options } from '@rezsi/shared';
import type { Env } from '../src/env.js';
import { HaClient, type NotifyPayload } from '../src/ha.js';
import { DataStore } from '../src/store.js';

export async function tempDir(prefix = 'rezsi-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export function testEnv(dataDir: string, overrides: Partial<Env> = {}): Env {
  return {
    dataDir,
    port: 0,
    host: '127.0.0.1',
    webDir: join(dataDir, 'web'),
    supervisor: false,
    allowedIps: [],
    dryRunNotify: true,
    ...overrides,
  };
}

export class FakeHa extends HaClient {
  sent: { service: string; payload: NotifyPayload }[] = [];
  states = new Map<string, unknown>();
  fail = false;

  constructor() {
    super(testEnv('/nonexistent'));
  }
  override get configured() {
    return true;
  }
  override async notify(service: string, payload: NotifyPayload) {
    if (this.fail) throw new Error('boom');
    this.sent.push({ service, payload });
  }
  override async setState(id: string, state: string | number, attributes: Record<string, unknown>) {
    this.states.set(id, { state, attributes });
  }
  override async getPanelPath() {
    return '/abcd1234_rezsi';
  }
}

export async function seededStore(dir: string): Promise<DataStore> {
  const store = new DataStore(dir);
  await store.init();
  const r = (value: number, date: string) => ({ value, date });
  await store.setProfile(2025, { gasProfile: { 1: 300, 2: 250, 9: 40, 10: 120, 11: 220, 12: 300 }, annualTargets: { gas: 2100, electricity: 2250 } });
  await store.upsertMonth(2025, 9, { month: 9, readings: { gas: r(6900, '2025-09-10'), electricity: r(41000, '2025-09-10') }, gasReported: r(6850, '2025-09-22'), bills: { gas: { amount: 9000, paid: true } } });
  await store.upsertMonth(2025, 10, { month: 10, readings: { gas: r(7000, '2025-10-10'), electricity: r(41180, '2025-10-10'), water: r(500, '2025-10-10') }, gasReported: r(6970, '2025-10-22'), bills: { gas: { amount: 21000, paid: true }, electricity: { amount: 12600, paid: true }, telecom: { amount: 9990, paid: true } } });
  await store.setProfile(2026, { gasProfile: { 9: 50, 10: 150, 11: 250, 12: 300 }, annualTargets: { gas: 2100 } });
  await store.upsertMonth(2026, 9, { month: 9, readings: { gas: r(7600, '2026-09-10'), electricity: r(43000, '2026-09-10'), water: r(540, '2026-09-01') }, gasReported: r(7462, '2026-09-22'), bills: { gas: { amount: 10000, paid: true }, electricity: { amount: 13000, paid: true } } });
  await store.upsertMonth(2026, 10, { month: 10, readings: { gas: r(7800, '2026-10-10'), electricity: r(43200, '2026-10-10') }, bills: { telecom: { amount: 10990, paid: false, dueDate: '2026-10-25' }, waste: { amount: 6150, paid: true } }, note: 'Szerelő, járt itt' });
  return store;
}

export function opts(o: Partial<Options> = {}): Options {
  return { ...defaultOptions(), ...o };
}
