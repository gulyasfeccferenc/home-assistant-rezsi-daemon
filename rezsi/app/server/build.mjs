// Bundles the server (including all dependencies and the shared package) into a single
// ESM file, so the runtime image needs no node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  // CommonJS dependencies (exceljs) call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
