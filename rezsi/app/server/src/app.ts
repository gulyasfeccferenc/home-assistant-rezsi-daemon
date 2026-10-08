import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  BILL_IDS,
  calcConfigFromOptions,
  computeYear,
  emptyYearFile,
  zonedParts,
  type Options,
} from '@rezsi/shared';
import type { Env } from './env.js';
import { publicOptions } from './env.js';
import type { ExportService } from './export/index.js';
import { formatImportReport, parseSheetWorkbook } from './importer.js';
import { logger } from './log.js';
import type { ReminderService } from './reminders.js';
import { createStaticHandler } from './static.js';
import { ValidationError, type DataStore } from './store.js';

const log = logger('http');

export interface AppDeps {
  env: Env;
  options: Options;
  store: DataStore;
  reminders: ReminderService;
  exporter: ExportService;
  version: string;
}

function parseYear(s: string): number {
  const y = Number(s);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new ValidationError('Érvénytelen év.');
  return y;
}

function parseMonth(s: string): number {
  const m = Number(s);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new ValidationError('Érvénytelen hónap.');
  return m;
}

function normalizeIp(ip: string | undefined): string {
  return (ip ?? '').replace(/^::ffff:/, '');
}

export function createApp(deps: AppDeps): Hono {
  const { env, options, store, reminders, exporter } = deps;
  const cfg = calcConfigFromOptions(options);
  const app = new Hono();

  // Only the Ingress gateway may talk to us when running as an add-on.
  if (env.allowedIps.length) {
    app.use('*', async (c, next) => {
      let ip: string | undefined;
      try {
        ip = normalizeIp(getConnInfo(c).remote.address);
      } catch {
        ip = undefined;
      }
      if (!ip || !env.allowedIps.includes(ip)) {
        log.warn(`Rejected request from ${ip ?? 'unknown'} to ${c.req.path}`);
        return c.text('Forbidden', 403);
      }
      await next();
    });
  }

  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    log.error(`${c.req.method} ${c.req.path} failed`, err);
    return c.json({ error: (err as Error).message || 'Belső hiba' }, 500);
  });

  const api = new Hono();

  api.get('/health', (c) => c.json({ ok: true, version: deps.version, years: store.listYears().length }));

  api.get('/config', (c) =>
    c.json({
      version: deps.version,
      options: publicOptions(options),
      calc: cfg,
      haConfigured: !!env.haApiUrl,
      supervisor: env.supervisor,
      dryRunNotify: env.dryRunNotify,
    }),
  );

  /** Everything the UI needs in one request; computation happens client-side with the shared package. */
  api.get('/data', (c) => c.json({ years: store.allYears(), tariffs: store.getTariffs(), loadErrors: store.loadErrors }));

  api.get('/years', (c) => c.json(store.listYears()));

  api.get('/years/:year', (c) => {
    const year = parseYear(c.req.param('year'));
    const file = store.getYear(year) ?? emptyYearFile(year);
    return c.json({ file, computed: computeYear(store.history(), year, cfg, zonedParts().date) });
  });

  api.put('/years/:year/months/:month', async (c) => {
    const year = parseYear(c.req.param('year'));
    const month = parseMonth(c.req.param('month'));
    const body = await c.req.json().catch(() => {
      throw new ValidationError('Hibás JSON.');
    });
    const file = await store.upsertMonth(year, month, body);
    return c.json({ file, computed: computeYear(store.history(), year, cfg, zonedParts().date) });
  });

  api.put('/years/:year/profile', async (c) => {
    const year = parseYear(c.req.param('year'));
    const body = await c.req.json().catch(() => {
      throw new ValidationError('Hibás JSON.');
    });
    return c.json({ file: await store.setProfile(year, body) });
  });

  api.get('/status', (c) => {
    const today = zonedParts().date;
    const year = Number(today.slice(0, 4));
    const computed = computeYear(store.history(), year, cfg, today);
    const unpaid = store.allYears().flatMap((f) =>
      f.months.flatMap((r) =>
        BILL_IDS.filter((id) => r.bills[id] && !r.bills[id]!.paid).map((id) => ({
          year: f.year,
          month: r.month,
          bill: id,
          amount: r.bills[id]!.amount,
          dueDate: r.bills[id]!.dueDate,
        })),
      ),
    );
    const state = store.getState();
    return c.json({
      today,
      meters: reminders.due(),
      reminders: state.reminders,
      lastReminderCheck: state.lastReminderCheck,
      checks: computed.checks,
      loadErrors: store.loadErrors,
      unpaid,
      totals: computed.totals,
      export: { ...state.export, enabled: options.export_enabled, remoteConfigured: !!options.git_repo_url },
    });
  });

  api.get('/tariffs', (c) => c.json(store.getTariffs()));
  api.put('/tariffs', async (c) => c.json(await store.setTariffs(await c.req.json())));

  api.post('/export', async (c) => {
    const result = await exporter.run('manual');
    return c.json(result, result.ok ? 200 : 502);
  });

  api.post('/notify/test', async (c) => {
    await reminders.sendTest();
    return c.json({ ok: true, dryRun: env.dryRunNotify || !env.haApiUrl });
  });

  api.post('/import', bodyLimit({ maxSize: 10 * 1024 * 1024 }), async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new ValidationError('Hiányzó fájl (file mező).');
    const report = await parseSheetWorkbook(Buffer.from(await file.arrayBuffer()), { today: zonedParts().date, cfg });
    const apply = c.req.query('apply') === '1';
    if (apply) {
      await store.replaceYears(report.years);
      log.info(`Imported years ${report.years.map((y) => y.year).join(', ')}`);
    }
    log.info(formatImportReport(report));
    return c.json({
      applied: apply,
      years: report.years.map((y) => y.year),
      summary: report.summary,
      warnings: report.warnings,
      mismatches: report.mismatches,
    });
  });

  api.all('*', (c) => c.json({ error: 'Nincs ilyen végpont.' }, 404));

  app.route('/api', api);
  app.get('*', createStaticHandler(env.webDir));
  return app;
}
