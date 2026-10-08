import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeZodError, optionsSchema, type Options } from '@rezsi/shared';
import { logger, registerSecret } from './log.js';

const log = logger('env');

export interface Env {
  dataDir: string;
  port: number;
  host: string;
  webDir: string;
  /** Running inside the Supervisor (add-on) rather than in development. */
  supervisor: boolean;
  /** Base URL of the Home Assistant REST API (`.../api`). */
  haApiUrl?: string;
  haToken?: string;
  supervisorUrl?: string;
  /** Only these client addresses may connect; empty = allow all (development). */
  allowedIps: string[];
  dryRunNotify: boolean;
}

export function loadEnv(): Env {
  const supervisorToken = process.env.SUPERVISOR_TOKEN;
  const here = dirname(fileURLToPath(import.meta.url));
  // In the image the web build sits next to the server bundle; in development under web/dist.
  const webDir =
    process.env.WEB_DIR ??
    [join(here, '../../web/dist'), join(here, '../web'), join(here, 'web')].find((p) => existsSync(join(p, 'index.html'))) ??
    join(here, '../../web/dist');

  const env: Env = {
    dataDir: resolve(process.env.DATA_DIR ?? (supervisorToken ? '/data' : './.data')),
    port: Number(process.env.PORT ?? 8099),
    host: process.env.HOST ?? '0.0.0.0',
    webDir,
    supervisor: !!supervisorToken,
    allowedIps: supervisorToken ? ['172.30.32.2'] : (process.env.ALLOWED_IPS ?? '').split(',').filter(Boolean),
    dryRunNotify: process.env.DRY_RUN_NOTIFY === '1',
  };
  if (supervisorToken) {
    env.haApiUrl = 'http://supervisor/core/api';
    env.haToken = supervisorToken;
    env.supervisorUrl = 'http://supervisor';
  } else if (process.env.HA_URL && process.env.HA_TOKEN) {
    env.haApiUrl = process.env.HA_URL.replace(/\/$/, '') + '/api';
    env.haToken = process.env.HA_TOKEN;
  }
  registerSecret(env.haToken);
  return env;
}

/** Reads `/data/options.json` written by the Supervisor; falls back to defaults in development. */
export function loadOptions(dataDir: string): Options {
  const file = join(dataDir, 'options.json');
  let raw: unknown = {};
  if (existsSync(file)) {
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      log.error(`Cannot read ${file}, using defaults`, err);
    }
  } else {
    log.info(`${file} not found, using default options`);
  }
  // Treat nulls (unset optional options) as missing.
  const cleaned = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => v !== null));
  const parsed = optionsSchema.safeParse(cleaned);
  if (!parsed.success) {
    log.error(`Invalid options, using defaults: ${describeZodError(parsed.error)}`);
    return optionsSchema.parse({});
  }
  registerSecret(parsed.data.git_token);
  return parsed.data;
}

/** Options as shown in the UI: secrets masked. */
export function publicOptions(o: Options): Record<string, unknown> {
  return { ...o, git_token: o.git_token ? '********' : '' };
}
