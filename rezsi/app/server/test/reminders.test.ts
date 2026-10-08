import { describe, expect, it } from 'vitest';
import { ReminderService } from '../src/reminders.js';
import { DataStore } from '../src/store.js';
import { FakeHa, opts, seededStore, tempDir } from './helpers.js';

const at = (iso: string) => () => new Date(iso);

describe('ReminderService', () => {
  it('sends once per day and not again after a restart', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    const ha = new FakeHa();
    // 2026-10-20 09:00 Budapest = 07:00 UTC
    const svc = new ReminderService(store, ha, opts(), at('2026-10-20T07:00:00Z'));
    const sent = await svc.run();
    expect(sent.map((s) => s.meter)).toEqual(['gas']);
    const msg = ha.sent[0].payload;
    expect(msg.message).toBe('Gáz diktálás: 10.20–10.28. Javasolt érték: 7\u00A0612\u00A0m³ Nem diktált: 338\u00A0m³');
    expect(msg.data).toMatchObject({ tag: 'rezsi-gas', group: 'rezsi', url: '/abcd1234_rezsi/rogzites/2026-10' });

    // Restart: fresh store from disk, startup run the same day.
    const store2 = new DataStore(dir);
    await store2.init();
    const ha2 = new FakeHa();
    await new ReminderService(store2, ha2, opts(), at('2026-10-20T10:00:00Z')).run({ startup: true });
    expect(ha2.sent).toHaveLength(0);
  });

  it('does not send at startup before the reminder time', async () => {
    const store = await seededStore(await tempDir());
    const ha = new FakeHa();
    await new ReminderService(store, ha, opts(), at('2026-10-20T05:00:00Z')).run({ startup: true });
    expect(ha.sent).toHaveLength(0);
    await new ReminderService(store, ha, opts(), at('2026-10-20T07:30:00Z')).run({ startup: true });
    expect(ha.sent).toHaveLength(1);
  });

  it('stops after the reading is entered and retries after a failed send', async () => {
    const store = await seededStore(await tempDir());
    const ha = new FakeHa();
    ha.fail = true;
    const svc = new ReminderService(store, ha, opts(), at('2026-10-20T07:00:00Z'));
    expect(await svc.run()).toEqual([]);
    expect(store.getState().reminders.gas?.lastSent).toBeUndefined();
    ha.fail = false;
    expect((await svc.run()).map((s) => s.meter)).toEqual(['gas']);
    await store.upsertMonth(2026, 10, {
      ...store.getYear(2026)!.months.find((m) => m.month === 10)!,
      gasReported: { value: 7612, date: '2026-10-22' },
    });
    expect(await new ReminderService(store, ha, opts(), at('2026-10-22T07:00:00Z')).run()).toEqual([]);
  });

  it('marks the last day as urgent', async () => {
    const store = await seededStore(await tempDir());
    const ha = new FakeHa();
    await new ReminderService(store, ha, opts(), at('2026-10-28T07:00:00Z')).run();
    expect(ha.sent[0].payload.message.startsWith('Utolsó nap!')).toBe(true);
    expect(ha.sent[0].payload.data).toMatchObject({ push: { 'interruption-level': 'time-sensitive' } });
  });
});
