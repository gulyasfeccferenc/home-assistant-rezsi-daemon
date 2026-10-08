import type { CalcConfig, ComputedYear, MeterDue, MonthRecord, ProfileUpdate, Tariff, YearFile, Check, YearTotals } from '@rezsi/shared';

// All URLs are relative (no leading slash) so they resolve against the Ingress base path.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`api/${path}`, {
    ...init,
    headers: init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export interface ConfigResponse {
  version: string;
  options: Record<string, unknown>;
  calc: CalcConfig;
  haConfigured: boolean;
  supervisor: boolean;
  dryRunNotify: boolean;
}

export interface DataResponse {
  years: YearFile[];
  tariffs: Tariff[];
  loadErrors: { file: string; error: string }[];
}

export interface ExportStatus {
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastCommit?: string;
  lastCommitMessage?: string;
  lastPushAt?: string;
  lastError?: string;
  enabled: boolean;
  remoteConfigured: boolean;
}

export interface StatusResponse {
  today: string;
  meters: MeterDue[];
  reminders: Partial<Record<string, { lastSent?: string; history?: { date: string; urgent: boolean; message: string }[] }>>;
  lastReminderCheck?: string;
  checks: Check[];
  unpaid: { year: number; month: number; bill: string; amount: number; dueDate?: string }[];
  totals: YearTotals;
  export: ExportStatus;
}

export interface ExportResult {
  ok: boolean;
  commit?: string;
  pushed: boolean;
  changedFiles: string[];
  error?: string;
}

export interface ImportResult {
  applied: boolean;
  years: number[];
  summary: string[];
  warnings: string[];
  mismatches: { year: number; month?: number; row: string; sheet: number; computed?: number }[];
}

export const api = {
  config: () => request<ConfigResponse>('config'),
  data: () => request<DataResponse>('data'),
  status: () => request<StatusResponse>('status'),
  saveMonth: (year: number, month: number, rec: MonthRecord) =>
    request<{ file: YearFile; computed: ComputedYear }>(`years/${year}/months/${month}`, { method: 'PUT', body: JSON.stringify(rec) }),
  saveProfile: (year: number, update: ProfileUpdate) =>
    request<{ file: YearFile }>(`years/${year}/profile`, { method: 'PUT', body: JSON.stringify(update) }),
  saveTariffs: (tariffs: Tariff[]) => request<Tariff[]>('tariffs', { method: 'PUT', body: JSON.stringify(tariffs) }),
  exportNow: () =>
    request<ExportResult>('export', { method: 'POST' }).catch((err: ApiError) => {
      throw err;
    }),
  testNotify: () => request<{ ok: boolean; dryRun: boolean }>('notify/test', { method: 'POST' }),
  importSheet: (file: File, apply: boolean) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImportResult>(`import${apply ? '?apply=1' : ''}`, { method: 'POST', body: form });
  },
};
