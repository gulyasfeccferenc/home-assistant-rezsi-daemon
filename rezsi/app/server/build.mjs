// Bundles the server (including all dependencies and the shared package) into a single
// ESM file, so the runtime image needs no node_modules.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// The add-on version lives in config.yaml; APP_VERSION overrides it.
let version = process.env.APP_VERSION;
try {
  version ??= /^version:\s*"?([^"\n]+)"?/m.exec(readFileSync(new URL('../../config.yaml', import.meta.url), 'utf8'))?.[1];
} catch {
  /* config.yaml not available */
}

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  legalComments: 'none',
  define: { __APP_VERSION__: JSON.stringify(version ?? 'dev') },
  logLevel: 'info',
  // CommonJS dependencies (exceljs) call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
