import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataStore, ValidationError } from '../src/store.js';
import { seededStore, tempDir } from './helpers.js';

describe('DataStore', () => {
  it('saves, reloads and validates month records', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    const reloaded = new DataStore(dir);
    await reloaded.init();
    expect(reloaded.listYears()).toEqual([2025, 2026]);
    expect(reloaded.getYear(2026)?.months.find((m) => m.month === 10)?.note).toBe('Szerelő, járt itt');
    await expect(store.upsertMonth(2026, 11, { month: 11, readings: { gas: { value: 'x' } }, bills: {} })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.upsertMonth(2026, 11, { month: 10, readings: {}, bills: {} })).rejects.toThrow(/hónap/);
    // No temp files left behind.
    expect((await readdir(join(dir, 'years'))).sort()).toEqual(['2025.json', '2026.json']);
  });

  it('raises lower readings in later months (also in later years) on save', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    await store.upsertMonth(2026, 11, { month: 11, readings: { electricity: { value: 43300, date: '2026-11-09' } }, bills: {} });
    await store.upsertMonth(2027, 1, { month: 1, readings: { electricity: { value: 43350, date: '2027-01-09' } }, bills: {} });
    const { adjustments } = await store.upsertMonth(2026, 10, {
      ...store.getYear(2026)!.months.find((m) => m.month === 10)!,
      readings: { gas: { value: 7800, date: '2026-10-10' }, electricity: { value: 44000, date: '2026-10-10' } },
    });
    expect(adjustments.map((a) => `${a.year}-${a.month} ${a.source} ${a.from}->${a.to}`)).toEqual([
      '2026-11 electricity 43300->44000',
      '2027-1 electricity 43350->44000',
    ]);
    const reloaded = new DataStore(dir);
    await reloaded.init();
    expect(reloaded.getYear(2027)!.months[0].readings.electricity).toEqual({ value: 44000, date: '2027-01-09', carried: true });
    // Earlier months are never touched.
    expect(reloaded.getYear(2026)!.months.find((m) => m.month === 9)!.readings.electricity!.value).toBe(43000);
  });

  it('marks repeated readings in existing data as carried placeholders once, with a backup', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'years'), { recursive: true });
    const r = (value: number, date: string) => ({ value, date });
    await writeFile(
      join(dir, 'years', '2026.json'),
      JSON.stringify({
        schemaVersion: 1,
        year: 2026,
        gasProfile: {},
        months: [
          { month: 10, readings: { electricity: r(4000, '2026-10-10') }, gasReported: r(900, '2026-10-22'), bills: {} },
          { month: 11, readings: { electricity: r(4000, '2026-11-10') }, gasReported: r(900, '2026-11-22'), bills: {} },
        ],
      }),
    );
    const store = new DataStore(dir);
    await store.init();
    const nov = store.getYear(2026)!.months[1];
    expect(nov.readings.electricity).toEqual({ value: 4000, date: '2026-11-10', carried: true });
    expect(nov.gasReported?.carried).toBe(true);
    expect(store.getState().migrations).toEqual(['carried-placeholders-v1']);
    expect((await readdir(join(dir, 'backup'))).length).toBe(1);

    // Entering the same value again makes it an actual reading; the migration does not run twice.
    await store.upsertMonth(2026, 11, { ...nov, readings: { electricity: r(4000, '2026-11-10') } });
    const again = new DataStore(dir);
    await again.init();
    expect(again.getYear(2026)!.months[1].readings.electricity!.carried).toBeUndefined();
    expect((await readdir(join(dir, 'backup'))).length).toBe(1);
  });

  it('remembers and restores dismissed warnings', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    await store.setDismissedChecks(['a|1', 'b|2', 'a|1'], true);
    const reloaded = new DataStore(dir);
    await reloaded.init();
    expect(reloaded.getDismissedChecks()).toEqual(['a|1', 'b|2']);
    expect(await reloaded.setDismissedChecks(['a|1'], false)).toEqual(['b|2']);
    expect(await reloaded.setDismissedChecks([], false)).toEqual([]);
  });

  it('removes a month when saved empty', async () => {
    const store = await seededStore(await tempDir());
    await store.upsertMonth(2026, 10, { month: 10, readings: {}, bills: {} });
    expect(store.getYear(2026)?.months.map((m) => m.month)).toEqual([9]);
  });

  it('writes stable, pretty JSON', async () => {
    const dir = await tempDir();
    await seededStore(dir);
    const text = await readFile(join(dir, 'years', '2026.json'), 'utf8');
    expect(text.startsWith('{\n  "schemaVersion": 1,\n  "year": 2026,\n  "gasProfile"')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('reports invalid files instead of crashing', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'years'), { recursive: true });
    await writeFile(join(dir, 'years', '2024.json'), '{"schemaVersion":1,"year":2024,"gasProfile":{},"months":[{"month":14}]}');
    const store = new DataStore(dir);
    await store.init();
    expect(store.listYears()).toEqual([]);
    expect(store.loadErrors[0].file).toBe('2024.json');
  });

  it('serializes concurrent writes', async () => {
    const store = await seededStore(await tempDir());
    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((m) => store.upsertMonth(2027, m, { month: m, readings: { electricity: { value: m, date: `2027-0${m}-01` } }, bills: {} })),
    );
    expect(store.getYear(2027)?.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
