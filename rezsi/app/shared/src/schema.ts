import { z } from 'zod';
import { BILL_IDS, METER_IDS, MONTHS, type BillId, type MeterId, type Month } from './categories.js';
import { isValidIsoDate } from './dates.js';

export const CURRENT_SCHEMA_VERSION = 1 as const;

export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, { message: 'Érvénytelen dátum (ÉÉÉÉ-HH-NN)' });

const monthSchema = z.number().int().min(1).max(12);

export const readingSchema = z
  .object({
    value: z.number().finite().nonnegative(),
    date: isoDateSchema,
  })
  .strict();
export type Reading = z.infer<typeof readingSchema>;

export const billSchema = z
  .object({
    amount: z.number().int().nonnegative(),
    paid: z.boolean(),
    dueDate: isoDateSchema.optional(),
    periodFrom: isoDateSchema.optional(),
    periodTo: isoDateSchema.optional(),
  })
  .strict();
export type Bill = z.infer<typeof billSchema>;

// Objects are built from the fixed id lists so that parse output has a stable key order;
// files written from parsed data therefore diff cleanly in git.
function fixedKeys<K extends string, S extends z.ZodTypeAny>(keys: readonly K[], value: S) {
  return z
    .object(Object.fromEntries(keys.map((k) => [k, value.optional()])) as { [P in K]: z.ZodOptional<S> })
    .strict();
}

export const readingsSchema = fixedKeys(METER_IDS, readingSchema) as unknown as z.ZodType<
  Partial<Record<MeterId, Reading>>
>;
export const billsSchema = fixedKeys(BILL_IDS, billSchema) as unknown as z.ZodType<Partial<Record<BillId, Bill>>>;

export type MonthlyValues = Partial<Record<Month, number>>;
export const monthlyValuesSchema = fixedKeys(
  MONTHS.map(String) as `${Month}`[],
  z.number().finite().nonnegative(),
) as unknown as z.ZodType<MonthlyValues>;

export const monthRecordSchema = z
  .object({
    month: monthSchema,
    readings: readingsSchema,
    gasReported: readingSchema.optional(),
    bills: billsSchema,
    note: z.string().max(2000).optional(),
  })
  .strict();
export type MonthRecord = z.infer<typeof monthRecordSchema>;

export const annualTargetsSchema = z
  .object({
    gas: z.number().finite().nonnegative().optional(),
    electricity: z.number().finite().nonnegative().optional(),
  })
  .strict();
export type AnnualTargets = z.infer<typeof annualTargetsSchema>;

export const yearFileSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    year: z.number().int().min(2000).max(2100),
    gasProfile: monthlyValuesSchema,
    annualTargets: annualTargetsSchema.optional(),
    months: z.array(monthRecordSchema).max(12),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<number>();
    for (const [i, rec] of file.months.entries()) {
      if (seen.has(rec.month)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['months', i, 'month'], message: `Duplikált hónap: ${rec.month}` });
      }
      seen.add(rec.month);
    }
  })
  .transform((file) => ({ ...file, months: [...file.months].sort((a, b) => a.month - b.month) }));
export type YearFile = z.output<typeof yearFileSchema>;

export const tariffSchema = z
  .object({
    bill: z.enum(BILL_IDS),
    validFrom: isoDateSchema,
    unitPrice: z.number().finite().nonnegative().optional(),
    fixedFee: z.number().finite().nonnegative().optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
export type Tariff = z.infer<typeof tariffSchema>;

export const settingsFileSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    tariffs: z.array(tariffSchema),
  })
  .strict()
  .transform((s) => ({
    ...s,
    tariffs: [...s.tariffs].sort((a, b) => a.bill.localeCompare(b.bill) || a.validFrom.localeCompare(b.validFrom)),
  }));
export type SettingsFile = z.output<typeof settingsFileSchema>;

export const profileUpdateSchema = z
  .object({
    gasProfile: monthlyValuesSchema,
    annualTargets: annualTargetsSchema.optional(),
  })
  .strict();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

/** Add-on options (`/data/options.json`). Defaults mirror `config.yaml`. */
export const optionsSchema = z.object({
  notify_service: z.string().min(1).default('mobile_app_ifecc'),
  reminder_time: hhmm.default('09:00'),
  repeat_every_days: z.number().int().min(1).max(7).default(2),
  gas_window_start_day: z.number().int().min(1).max(28).default(20),
  gas_window_end_day: z.number().int().min(1).max(31).default(28),
  electricity_window_start_day: z.number().int().min(1).max(28).default(8),
  electricity_window_end_day: z.number().int().min(1).max(31).default(11),
  water_interval_days: z.number().int().min(7).max(365).default(60),
  water_window_days: z.number().int().min(1).max(31).default(7),
  yoy_warning_percent: z.number().int().min(1).max(100).default(15),
  publish_entities: z.boolean().default(true),
  export_enabled: z.boolean().default(false),
  export_day: z.number().int().min(1).max(28).default(1),
  export_time: hhmm.default('06:00'),
  git_repo_url: z.string().optional().default(''),
  git_token: z.string().optional().default(''),
  git_branch: z.string().optional().default('main'),
  git_author_name: z.string().min(1).default('Rezsi add-on'),
  git_author_email: z.string().min(3).default('rezsi@localhost'),
});
export type Options = z.output<typeof optionsSchema>;

export function defaultOptions(): Options {
  return optionsSchema.parse({});
}

/** Formats zod issues as a short, human-readable message. */
export function describeZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export function emptyYearFile(year: number): YearFile {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, year, gasProfile: {}, months: [] };
}

/**
 * Migration hook: upgrades raw JSON of any known older schema version to the current one.
 * Version 1 is the first version, so there is nothing to migrate yet.
 */
export function migrateYearFile(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !('schemaVersion' in raw)) {
    return { ...(raw as object), schemaVersion: CURRENT_SCHEMA_VERSION };
  }
  return raw;
}
