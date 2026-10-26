import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ExportService } from '../src/export/index.js';
import { ReminderService } from '../src/reminders.js';
import { injectBase } from '../src/static.js';
import { FakeHa, opts, seededStore, tempDir, testEnv } from './helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

async function setup(allowedIps: string[] = []) {
  const dir = await tempDir();
  const store = await seededStore(dir);
  const env = testEnv(dir, { allowedIps });
  await mkdir(env.webDir, { recursive: true });
  await writeFile(join(env.webDir, 'index.html'), '<!doctype html><html><head><title>Rezsi</title></head><body></body></html>');
  const ha = new FakeHa();
  const o = opts();
  const app = createApp({
    env,
    options: o,
    store,
    reminders: new ReminderService(store, ha, o),
    exporter: new ExportService(store, ha, o, join(dir, 'export')),
    version: 'test',
  });
  return { app, store, ha };
}

describe('HTTP API', () => {
  it('serves health and data', async () => {
    const { app } = await setup();
    expect(await body(app.request('/api/health'))).toMatchObject({ ok: true, years: 2 });
    const year = await body(app.request('/api/years/2026'));
    expect(year.file.year).toBe(2026);
    expect(year.computed.months[9].consumption.gas.value).toBe(200);
    expect(await body(app.request('/api/years'))).toEqual([2025, 2026]);
  });

  it('validates writes', async () => {
    const { app } = await setup();
    const bad = await app.request('/api/years/2026/months/11', { method: 'PUT', body: '{"month":11,"readings":{},"bills":{"gas":{"amount":-5,"paid":true}}}' });
    expect(bad.status).toBe(400);
    expect((await body(bad)).error).toMatch(/bills.gas.amount/);
    const ok = await app.request('/api/years/2026/months/11', {
      method: 'PUT',
      body: JSON.stringify({ month: 11, readings: { electricity: { value: 43400, date: '2026-11-09' } }, bills: {} }),
    });
    expect(ok.status).toBe(200);
    expect((await app.request('/api/years/1999')).status).toBe(400);
    const profile = await app.request('/api/years/2027/profile', { method: 'PUT', body: '{"gasProfile":{"1":300},"annualTargets":{"gas":2000}}' });
    expect((await body(profile)).file.gasProfile).toEqual({ 1: 300 });
  });

  it('returns status with due meters and unpaid bills', async () => {
    const { app } = await setup();
    const status = await body(app.request('/api/status'));
    expect(status.meters.map((m: { meter: string }) => m.meter)).toEqual(['gas', 'electricity', 'water']);
    expect(status.unpaid).toEqual([{ year: 2026, month: 10, bill: 'telecom', amount: 10990, dueDate: '2026-10-25' }]);
  });

  it('deletes warnings and restores them', async () => {
    const { app } = await setup();
    const before = await body(app.request('/api/status'));
    const target = before.checks.find((c: { code: string }) => c.code === 'bill_unpaid' || c.code === 'bill_overdue');
    expect(target).toBeDefined();
    const key = `${target.code}|${target.year}|${target.month}|${target.category}`;
    expect((await app.request('/api/checks/dismiss', { method: 'POST', body: '{}' })).status).toBe(400);
    const res = await body(app.request('/api/checks/dismiss', { method: 'POST', body: JSON.stringify({ keys: [key] }) }));
    expect(res.dismissedChecks).toEqual([key]);
    const after = await body(app.request('/api/status'));
    expect(after.checks.length).toBe(before.checks.length - 1);
    expect((await body(app.request('/api/data'))).dismissedChecks).toEqual([key]);
    await app.request('/api/checks/dismiss', { method: 'DELETE' });
    expect((await body(app.request('/api/status'))).checks.length).toBe(before.checks.length);
  });

  it('reports carried-forward readings when saving', async () => {
    const { app } = await setup();
    await app.request('/api/years/2026/months/11', {
      method: 'PUT',
      body: JSON.stringify({ month: 11, readings: { electricity: { value: 43100, date: '2026-11-09' } }, bills: {} }),
    });
    const res = await body(
      app.request('/api/years/2026/months/10', {
        method: 'PUT',
        body: JSON.stringify({ month: 10, readings: { electricity: { value: 43200, date: '2026-10-10' } }, bills: {} }),
      }),
    );
    expect(res.adjustments).toEqual([{ year: 2026, month: 11, source: 'electricity', from: 43100, to: 43200 }]);
    expect(res.years.find((y: { year: number }) => y.year === 2026).months.find((m: { month: number }) => m.month === 11).readings.electricity.value).toBe(43200);
  });

  it('stores tariffs', async () => {
    const { app } = await setup();
    const res = await app.request('/api/tariffs', { method: 'PUT', body: '[{"bill":"gas","validFrom":"2026-01-01","unitPrice":102}]' });
    expect(await body(res)).toEqual([{ bill: 'gas', validFrom: '2026-01-01', unitPrice: 102 }]);
  });

  it('serves the SPA with an Ingress base and deep links', async () => {
    const { app } = await setup();
    const res = await app.request('/rogzites/2026-10', { headers: { 'X-Ingress-Path': '/api/hassio_ingress/abc' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<base href="/api/hassio_ingress/abc/" />');
    expect((await app.request('/../../etc/passwd')).status).toBe(404);
    expect((await app.request('/api/nope')).status).toBe(404);
  });

  it('rejects clients other than the Ingress gateway', async () => {
    const { app } = await setup(['172.30.32.2']);
    const env = (ip: string) => ({ incoming: { socket: { remoteAddress: ip, remotePort: 1, remoteFamily: 'IPv4' } } });
    expect((await app.request('/api/health', {}, env('192.168.1.5'))).status).toBe(403);
    expect((await app.request('/api/health', {}, env('172.30.32.2'))).status).toBe(200);
    expect((await app.request('/api/health', {}, env('::ffff:172.30.32.2'))).status).toBe(200);
  });

  it('sanitizes the base path', () => {
    expect(injectBase('<head></head>', '/x/"><script>')).toContain('<base href="/x/script/" />');
    expect(injectBase('<head></head>', undefined)).toContain('<base href="/" />');
  });
});
