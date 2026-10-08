// Minimal stdout logger; the add-on Log tab shows stdout/stderr.

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? ORDER.info;

/** Values registered here are masked in every log line (tokens, credentials). */
const secrets = new Set<string>();

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 4) secrets.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

function write(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (ORDER[level] < threshold) return;
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) {
    line += ' ' + (extra instanceof Error ? extra.stack ?? extra.message : typeof extra === 'string' ? extra : JSON.stringify(extra));
  }
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(redact(line) + '\n');
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => write('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => write('error', scope, msg, extra),
  };
}
export type Logger = ReturnType<typeof logger>;
