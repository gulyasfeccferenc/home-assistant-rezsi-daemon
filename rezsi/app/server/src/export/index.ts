import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { calcConfigFromOptions, today as todayIn, type Options } from '@rezsi/shared';
import { Git } from '../git.js';
import type { HaClient } from '../ha.js';
import { logger } from '../log.js';
import { atomicWrite, Mutex, toJson } from '../storage.js';
import type { DataStore } from '../store.js';
import { yearToCsv } from './csv.js';
import { monthlyReport } from './markdown.js';
import { yearToXlsx } from './xlsx.js';

const log = logger('export');

/** Bump when the xlsx layout changes so that all workbooks are regenerated. */
const XLSX_FORMAT_VERSION = 1;

async function writeIfChanged(path: string, content: string | Buffer): Promise<boolean> {
  try {
    const existing = await readFile(path);
    if (existing.equals(Buffer.isBuffer(content) ? content : Buffer.from(content))) return false;
  } catch {
    /* missing */
  }
  await atomicWrite(path, content);
  return true;
}

/**
 * Writes all export files into `dir`. Output is deterministic: no timestamps inside text files,
 * and xlsx files (whose zip container embeds timestamps) are only rewritten when their inputs change.
 */
export async function writeExportFiles(dir: string, store: DataStore, options: Options, today: string): Promise<string[]> {
  const cfg = calcConfigFromOptions(options);
  const history = store.history();
  const written: string[] = [];
  const manifestPath = join(dir, 'xlsx', 'manifest.json');
  let manifest: Record<string, string> = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    /* first run */
  }

  for (const file of store.allYears()) {
    const y = file.year;
    const out = async (rel: string, content: string | Buffer) => {
      if (await writeIfChanged(join(dir, rel), content)) written.push(rel);
    };
    await out(`data/${y}.json`, toJson(file));
    await out(`csv/${y}.csv`, yearToCsv(file));
    for (const rec of file.months) {
      await out(`reports/${y}-${String(rec.month).padStart(2, '0')}.md`, monthlyReport(history, y, rec.month, cfg, today));
    }
    const xlsxName = `rezsi-${y}.xlsx`;
    const signature = createHash('sha256')
      .update(JSON.stringify([XLSX_FORMAT_VERSION, file, store.getYear(y - 1) ?? null, cfg]))
      .digest('hex');
    if (manifest[xlsxName] !== signature) {
      await atomicWrite(join(dir, 'xlsx', xlsxName), await yearToXlsx(history, y, cfg));
      manifest[xlsxName] = signature;
      written.push(`xlsx/${xlsxName}`);
    }
  }
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await writeIfChanged(manifestPath, toJson(sorted));
  return written;
}

export interface ExportResult {
  ok: boolean;
  commit?: string;
  pushed: boolean;
  changedFiles: string[];
  error?: string;
}

export class ExportService {
  private readonly mutex = new Mutex();

  constructor(
    private readonly store: DataStore,
    private readonly ha: HaClient,
    private readonly options: Options,
    private readonly dir: string,
  ) {}

  /** `monthly`: scheduled run (commit `report: YYYY-MM` for the previous month); `manual`: button. */
  run(kind: 'monthly' | 'manual', now = new Date()): Promise<ExportResult> {
    return this.mutex.run(() => this.doRun(kind, now));
  }

  private async doRun(kind: 'monthly' | 'manual', now: Date): Promise<ExportResult> {
    const o = this.options;
    const today = todayIn(now);
    const [y, m] = today.split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const message = kind === 'monthly' ? `report: ${prev}` : `export: manual ${today}`;
    const git = new Git({
      dir: this.dir,
      url: o.git_repo_url.trim(),
      token: o.git_token,
      branch: o.git_branch || 'main',
      authorName: o.git_author_name,
      authorEmail: o.git_author_email,
    });
    const result: ExportResult = { ok: false, pushed: false, changedFiles: [] };
    let stage = 'prepare';
    try {
      let prepareError: Error | undefined;
      try {
        await git.prepare();
      } catch (err) {
        // Still write and commit locally; the push is retried on the next run.
        prepareError = err as Error;
        log.warn(`Preparing export repository failed: ${prepareError.message}`);
      }
      stage = 'write';
      result.changedFiles = await writeExportFiles(this.dir, this.store, o, today);
      stage = 'commit';
      result.commit = await git.commitAll(message);
      if (prepareError) {
        stage = 'prepare';
        throw prepareError;
      }
      stage = 'push';
      result.pushed = await git.push();
      result.ok = true;
    } catch (err) {
      result.error = `${stage}: ${(err as Error).message}`;
    }

    const head = await git.head();
    log.info(
      `Export (${kind}) ${result.ok ? 'ok' : 'FAILED'}: ${result.changedFiles.length} file(s) changed, ` +
        `commit ${result.commit ?? 'none'}, pushed ${result.pushed}${result.error ? `, error: ${result.error}` : ''}`,
    );
    const notifyError = !result.ok && !this.store.getState().export.errorNotified;
    await this.store.updateState((s) => {
      const e = s.export;
      e.lastRunAt = now.toISOString();
      if (result.commit) {
        e.lastCommit = result.commit;
        e.lastCommitMessage = message;
      } else if (head) e.lastCommit ??= head;
      if (result.pushed) e.lastPushAt = now.toISOString();
      if (kind === 'monthly') e.lastMonthly = today.slice(0, 7);
      if (result.ok) {
        e.lastSuccessAt = now.toISOString();
        delete e.lastError;
        delete e.errorNotified;
      } else {
        e.lastError = result.error;
        if (notifyError) e.errorNotified = true;
      }
    });
    if (notifyError) {
      try {
        await this.ha.notify(o.notify_service, {
          title: 'Rezsi – export hiba',
          message: `Az exportálás nem sikerült: ${result.error}`.slice(0, 300),
          data: { tag: 'rezsi-export', group: 'rezsi' },
        });
      } catch (err) {
        log.warn('Cannot send export error notification', err);
      }
    }
    return result;
  }
}
