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
