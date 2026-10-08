import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { calcConfigFromOptions } from '@rezsi/shared';
import { describe, expect, it } from 'vitest';
import { yearToCsv } from '../src/export/csv.js';
import { ExportService, writeExportFiles } from '../src/export/index.js';
import { monthlyReport } from '../src/export/markdown.js';
import { FakeHa, opts, seededStore, tempDir } from './helpers.js';

describe('export files', () => {
  it('CSV (snapshot)', async () => {
    const store = await seededStore(await tempDir());
    expect(yearToCsv(store.getYear(2026)!)).toMatchSnapshot();
  });

  it('Markdown report (snapshot)', async () => {
    const store = await seededStore(await tempDir());
    expect(monthlyReport(store.history(), 2026, 10, calcConfigFromOptions(opts()), '2026-10-31')).toMatchSnapshot();
  });

  it('xlsx has the sheet layout', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    await writeExportFiles(join(dir, 'out'), store, opts(), '2026-10-08');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(dir, 'out', 'xlsx', 'rezsi-2026.xlsx'));
    const ws = wb.getWorksheet('2026 - Rezsi')!;
    expect(ws.getCell('A3').value).toBe('Gáz');
    // October = columns 20 (reading) and 21 (payable)
    expect(ws.getCell(1, 20).value).toBe('Október (2026.10.10.)');
    expect(ws.getCell(3, 20).value).toBe(7800);
    expect(ws.getCell(6, 21).value).toBe(10990);
    expect(ws.getCell(6, 21).numFmt).toBe('#,##0 "Ft"');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 1 });
  });

  it('is deterministic: a second run changes nothing', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    const first = await writeExportFiles(join(dir, 'out'), store, opts(), '2026-10-08');
    expect(first).toContain('reports/2026-10.md');
    expect(await writeExportFiles(join(dir, 'out'), store, opts(), '2026-10-08')).toEqual([]);
    await store.upsertMonth(2026, 9, { ...store.getYear(2026)!.months[0], note: 'új' });
    const third = await writeExportFiles(join(dir, 'out'), store, opts(), '2026-10-08');
    expect(third).toEqual(expect.arrayContaining(['data/2026.json', 'reports/2026-09.md', 'xlsx/rezsi-2026.xlsx']));
    expect(third).not.toContain('csv/2026.csv');
  });
});

describe('ExportService with git', () => {
  function git(cwd: string, ...args: string[]) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  }

  it('commits and pushes to the remote, only when something changed', async () => {
    const dir = await tempDir();
    const remote = join(dir, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    const store = await seededStore(dir);
    const ha = new FakeHa();
    const o = opts({ git_repo_url: remote, git_token: 'secret-token-123', git_author_name: 'Teszt', git_author_email: 't@example.com' });
    const svc = new ExportService(store, ha, o, join(dir, 'export'));

    const r1 = await svc.run('monthly', new Date('2026-10-01T04:00:00Z'));
    expect(r1).toMatchObject({ ok: true, pushed: true });
    expect(git(remote, 'log', '--format=%s|%an', 'main')).toBe('report: 2026-09|Teszt');
    expect(git(remote, 'show', 'main:reports/2026-10.md')).toContain('# Rezsi – 2026. október');
    expect(store.getState().export).toMatchObject({ lastMonthly: '2026-10', lastCommitMessage: 'report: 2026-09' });

    const r2 = await svc.run('manual', new Date('2026-10-08T10:00:00Z'));
    expect(r2).toMatchObject({ ok: true, pushed: false, commit: undefined });

    await store.upsertMonth(2026, 11, { month: 11, readings: {}, bills: { telecom: { amount: 10990, paid: false } } });
    const r3 = await svc.run('manual', new Date('2026-11-08T10:00:00Z'));
    expect(r3).toMatchObject({ ok: true, pushed: true });
    expect(git(remote, 'log', '-1', '--format=%s', 'main')).toBe('export: manual 2026-11-08');
    // The token never ends up in the repository config.
    expect(await readFile(join(dir, 'export', '.git', 'config'), 'utf8')).not.toContain('secret-token');
  });

  it('records push errors, notifies once, and pushes on the next run', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    const ha = new FakeHa();
    const missing = join(dir, 'missing.git');
    const svc = new ExportService(store, ha, opts({ git_repo_url: missing }), join(dir, 'export'));
    const r1 = await svc.run('manual');
    expect(r1.ok).toBe(false);
    expect(r1.commit).toBeDefined(); // local commit kept
    expect(store.getState().export.lastError).toMatch(/prepare|fetch/);
    await svc.run('manual');
    expect(ha.sent.filter((s) => s.payload.title.includes('export'))).toHaveLength(1);

    execFileSync('git', ['init', '-q', '--bare', missing]);
    const r3 = await svc.run('manual');
    expect(r3).toMatchObject({ ok: true, pushed: true });
    expect(store.getState().export.lastError).toBeUndefined();
  });

  it('works without a remote (local commits only)', async () => {
    const dir = await tempDir();
    const store = await seededStore(dir);
    const r = await new ExportService(store, new FakeHa(), opts(), join(dir, 'export')).run('manual');
    expect(r).toMatchObject({ ok: true, pushed: false });
    expect(r.commit).toMatch(/^[0-9a-f]+$/);
  });
});
