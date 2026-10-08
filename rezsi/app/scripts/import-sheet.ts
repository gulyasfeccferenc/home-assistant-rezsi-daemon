/**
 * One-time import of the Google Sheet xlsx export.
 *
 *   pnpm import-sheet path/to/Rezsi.xlsx            # dry run: prints the report
 *   pnpm import-sheet path/to/Rezsi.xlsx --apply    # writes $DATA_DIR/years/<year>.json
 *
 * Existing year files are backed up to $DATA_DIR/backup before being replaced.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { today } from '@rezsi/shared';
import { formatImportReport, parseSheetWorkbook } from '../server/src/importer.js';
import { DataStore } from '../server/src/store.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: pnpm import-sheet <file.xlsx> [--apply]');
  process.exit(2);
}
const report = await parseSheetWorkbook(await readFile(resolve(file)), { today: today() });
console.log(formatImportReport(report));
if (args.includes('--apply')) {
  const dataDir = resolve(process.env.DATA_DIR ?? './.data');
  const store = new DataStore(dataDir);
  await store.init();
  await store.replaceYears(report.years);
  console.log(`Written to ${dataDir}/years: ${report.years.map((y) => y.year).join(', ')}`);
} else {
  console.log('\nDry run. Add --apply to write the year files.');
}
