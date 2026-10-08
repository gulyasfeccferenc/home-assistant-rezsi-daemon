/**
 * Writes fictional but realistic sample data for development: `pnpm seed [--force]`.
 * Target: $DATA_DIR/years (default ./.data). Values are made up.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { daysInMonth, isoDate, today as todayIn, yearFileSchema, type MonthRecord, type YearFile } from '@rezsi/shared';

const dataDir = resolve(process.env.DATA_DIR ?? './.data');
const force = process.argv.includes('--force');

// Typical Hungarian household: gas heating, profile peaks in winter.
const GAS_PROFILE = [330, 280, 220, 130, 60, 30, 25, 25, 45, 130, 230, 310];
const GAS_ACTUAL = [360, 300, 210, 120, 55, 28, 24, 26, 50, 150, 250, 330];
const ELECTRICITY = [230, 210, 200, 180, 170, 190, 220, 215, 180, 190, 210, 240];
const WATER_PER_MONTH = 6;

function build(year: number, until: string, start: { gas: number; reported: number; el: number; water: number }, factor: number) {
  const file: YearFile = {
    schemaVersion: 1,
    year,
    gasProfile: Object.fromEntries(GAS_PROFILE.map((v, i) => [i + 1, v])),
    annualTargets: { gas: 2100, electricity: 2250 },
    months: [],
  };
  let { gas, reported, el, water } = start;
  for (let m = 1; m <= 12; m++) {
    const readDate = isoDate(year, m, 10);
    if (readDate > until) break;
    gas += Math.round(GAS_ACTUAL[m - 1] * factor);
    el += Math.round(ELECTRICITY[m - 1] * factor);
    const rec: MonthRecord = {
      month: m,
      readings: { gas: { value: gas, date: readDate }, electricity: { value: el, date: readDate } },
      bills: {},
    };
    const reportDate = isoDate(year, m, Math.min(22, daysInMonth(year, m)));
    if (reportDate <= until) {
      reported = Math.min(gas, reported + GAS_PROFILE[m - 1]);
      rec.gasReported = { value: reported, date: reportDate };
    }
    if (m % 2 === 0) {
      water += WATER_PER_MONTH * 2;
      rec.readings.water = { value: water, date: readDate };
      rec.bills.water = { amount: Math.round(WATER_PER_MONTH * 2 * 780), paid: true };
    }
    // Only the running month's bills are still open.
    const unpaid = until === todayIn() && readDate.slice(0, 7) === until.slice(0, 7);
    rec.bills.gas = { amount: Math.round(GAS_PROFILE[m - 1] * 105 + 1500), paid: !unpaid };
    rec.bills.electricity = { amount: Math.round(ELECTRICITY[m - 1] * factor * 37 + 900), paid: !unpaid };
    rec.bills.telecom = { amount: year >= 2026 ? 10990 : 9990, paid: !unpaid, ...(unpaid ? { dueDate: isoDate(year, m, 25) } : {}) };
    if (m % 3 === 1) rec.bills.waste = { amount: 6150, paid: true };
    file.months.push(rec);
  }
  return { file: yearFileSchema.parse(file), end: { gas, reported, el, water } };
}

const now = todayIn();
const y = Number(now.slice(0, 4));
const a = build(y - 1, `${y - 1}-12-31`, { gas: 5200, reported: 5100, el: 38000, water: 420 }, 1);
const b = build(y, now, a.end, 1.08);

await mkdir(join(dataDir, 'years'), { recursive: true });
for (const f of [a.file, b.file]) {
  const path = join(dataDir, 'years', `${f.year}.json`);
  if (existsSync(path) && !force) {
    console.log(`${path} exists, skipping (use --force to overwrite)`);
    continue;
  }
  await writeFile(path, JSON.stringify(f, null, 2) + '\n');
  console.log(`wrote ${path}`);
}
