import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { createApp } from './app.js';
import { EntityPublisher } from './entities.js';
import { loadEnv, loadOptions } from './env.js';
import { ExportService } from './export/index.js';
import { HaClient } from './ha.js';
import { logger } from './log.js';
import { ReminderService } from './reminders.js';
import { Scheduler } from './scheduler.js';
import { DataStore } from './store.js';

declare const __APP_VERSION__: string | undefined;
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : process.env.APP_VERSION ?? 'dev';

const log = logger('main');

async function main(): Promise<void> {
  const env = loadEnv();
  const options = loadOptions(env.dataDir);
  log.info(`Rezsi ${VERSION} starting (data: ${env.dataDir}, ${env.supervisor ? 'add-on mode' : 'development mode'})`);

  const store = new DataStore(env.dataDir);
  await store.init();
  const ha = new HaClient(env);
  const reminders = new ReminderService(store, ha, options);
  const exporter = new ExportService(store, ha, options, join(env.dataDir, 'export'));
  const entities = new EntityPublisher(store, ha, reminders, options);
  store.onChange(() => entities.schedule());

  const app = createApp({ env, options, store, reminders, exporter, version: VERSION });
  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
    log.info(`Listening on ${env.host}:${info.port}${env.allowedIps.length ? ` (allowed: ${env.allowedIps.join(', ')})` : ''}`);
  });

  const scheduler = new Scheduler(options, store, reminders, exporter, entities);
  scheduler.start();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received, shutting down`);
    scheduler.stop();
    entities.stop();
    server.close();
    try {
      await Promise.race([store.flush(), new Promise((r) => setTimeout(r, 5000))]);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('Fatal error during startup', err);
  process.exit(1);
});
