import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  BILLS,
  BILL_IDS,
  computeChecks,
  formatDate,
  formatNumber,
  formatQuantity,
  History,
  isoDate,
  METERS,
  METER_IDS,
  monthlyWindow,
  monthRecordSchema,
  parseNumberInput,
  suggestGasReport,
  type BillId,
  type MeterId,
  type MonthRecord,
  type YearFile,
} from '@rezsi/shared';
import { api } from '../api';
import { Badge, Card, Checks, MonthNav, toast } from '../components';
import { navigate, type Route } from '../router';
import { useApp } from '../state';

interface ReadingDraft {
  value: string;
  date: string;
}
interface BillDraft {
  amount: string;
  paid: boolean;
  dueDate: string;
}
interface Draft {
  readings: Record<MeterId, ReadingDraft>;
  reported: ReadingDraft;
  bills: Record<BillId, BillDraft>;
  note: string;
}

const num = (v: number | undefined) => (v === undefined ? '' : formatNumber(v, 3, ' '));

function defaultDate(year: number, month: number, today: string): string {
  return today.startsWith(`${year}-${String(month).padStart(2, '0')}`) ? today : isoDate(year, month, 10);
}

function toDraft(rec: MonthRecord | undefined, year: number, month: number, today: string, prefillReported?: number): Draft {
  const d = defaultDate(year, month, today);
  const readings = Object.fromEntries(
    METER_IDS.map((m) => [m, { value: num(rec?.readings[m]?.value), date: rec?.readings[m]?.date ?? d }]),
  ) as Draft['readings'];
  const bills = Object.fromEntries(
    BILL_IDS.map((b) => {
      const bill = rec?.bills[b];
      return [b, { amount: bill ? formatNumber(bill.amount, 0, ' ') : '', paid: bill?.paid ?? false, dueDate: bill?.dueDate ?? '' }];
    }),
  ) as Draft['bills'];
  return {
    readings,
    reported: { value: rec?.gasReported ? num(rec.gasReported.value) : num(prefillReported), date: rec?.gasReported?.date ?? d },
    bills,
    note: rec?.note ?? '',
  };
}

type FieldErrors = Record<string, string>;

function toRecord(draft: Draft, month: number): { record: MonthRecord; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const record: MonthRecord = { month, readings: {}, bills: {} };
  const reading = (key: string, r: ReadingDraft) => {
    const v = parseNumberInput(r.value);
    if (v === undefined) return undefined;
    if (Number.isNaN(v) || v < 0) {
      errors[key] = 'Érvénytelen szám';
      return undefined;
    }
    if (!r.date) {
      errors[key] = 'Adj meg dátumot';
      return undefined;
    }
    return { value: v, date: r.date };
  };
  for (const m of METER_IDS) {
    const r = reading(m, draft.readings[m]);
    if (r) record.readings[m] = r;
  }
  const rep = reading('gasReported', draft.reported);
  if (rep) record.gasReported = rep;
  for (const b of BILL_IDS) {
    const d = draft.bills[b];
    const v = parseNumberInput(d.amount);
    if (v === undefined) continue;
    if (Number.isNaN(v) || v < 0) {
      errors[`bill-${b}`] = 'Érvénytelen összeg';
      continue;
    }
    record.bills[b] = { amount: Math.round(v), paid: d.paid, ...(d.dueDate ? { dueDate: d.dueDate } : {}) };
  }
  if (draft.note.trim()) record.note = draft.note.trim();
  return { record, errors };
}

/** History with the draft month applied, for live consumption, suggestions and checks. */
function draftHistory(years: YearFile[], year: number, record: MonthRecord): History {
  const files = years.filter((f) => f.year !== year);
  const base = years.find((f) => f.year === year) ?? { schemaVersion: 1 as const, year, gasProfile: {}, months: [] };
  files.push({ ...base, months: [...base.months.filter((m) => m.month !== record.month), record].sort((a, b) => a.month - b.month) });
  return new History(files);
}

function Field({ label, error, children, hint }: { label: string; error?: string; hint?: preact.ComponentChildren; children: preact.ComponentChildren }) {
  return (
    <div class={`field ${error ? 'has-error' : ''}`}>
      <span class="field-label">{label}</span>
      {children}
      {error ? <span class="field-error">{error}</span> : hint ? <span class="field-hint">{hint}</span> : null}
    </div>
  );
}

export function EntryView({ route }: { route: Extract<Route, { view: 'entry' }> }) {
  const { data, config, today, applyYear } = useApp();
  const [ty, tm] = today.split('-').map(Number);
  const year = route.year ?? ty;
  const month = route.month ?? tm;
  const years = data?.years ?? [];
  const cfg = config!.calc;
  const savedHistory = useMemo(() => new History(years), [years]);
  const saved = savedHistory.record(year, month);

  const initial = useMemo(() => {
    // Pre-fill the suggested report once the gas window has opened (or for past months).
    const windowOpen = today >= monthlyWindow(year, month, cfg.gasWindow).start;
    const suggestion = !saved?.gasReported && windowOpen ? suggestGasReport(savedHistory, year, month)?.value : undefined;
    return toDraft(saved, year, month, today, suggestion);
  }, [saved, year, month, today, savedHistory, cfg]);
  // Compare against the saved state (without the pre-filled suggestion) so that accepting the
  // suggestion as-is still counts as a change worth saving.
  const pristine = useMemo(() => JSON.stringify(toDraft(saved, year, month, today)), [saved, year, month, today]);

  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string>();
  useEffect(() => {
    setDraft(initial);
    setServerError(undefined);
  }, [initial]);

  const dirty = JSON.stringify(draft) !== pristine;
  const { record, errors } = toRecord(draft, month);
  const history = useMemo(() => draftHistory(years, year, record), [years, year, JSON.stringify(record)]);
  const checks = useMemo(
    () => computeChecks(history, year, cfg, today).filter((c) => c.month === month && c.code !== 'reading_missing'),
    [history, year, month, cfg, today],
  );
  const suggestion = suggestGasReport(history, year, month);
  const hasErrors = Object.keys(errors).length > 0 || checks.some((c) => c.level === 'error');

  const update = (fn: (d: Draft) => void) =>
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const goTo = (y: number, m: number) => {
    if (dirty && !confirm('Mentetlen módosítások vannak. Biztosan másik hónapra lépsz?')) return;
    navigate({ view: 'entry', year: y, month: m });
  };

  const save = async (e: Event) => {
    e.preventDefault();
    if (Object.keys(errors).length) return;
    const parsed = monthRecordSchema.safeParse(record);
    if (!parsed.success) {
      setServerError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setSaving(true);
    try {
      const res = await api.saveMonth(year, month, parsed.data);
      applyYear(res.file);
      setServerError(undefined);
      toast('Mentve');
    } catch (err) {
      setServerError((err as Error).message);
      toast('Mentés sikertelen', 'bad');
    } finally {
      setSaving(false);
    }
  };

  const gasWindow = monthlyWindow(year, month, cfg.gasWindow);
  const elWindow = monthlyWindow(year, month, cfg.electricityWindow);

  return (
    <form class="stack entry" onSubmit={save} noValidate>
      <div class="entry-head">
        <h1 class="page-title">Rögzítés</h1>
        <MonthNav year={year} month={month} onChange={goTo} />
      </div>

      <Card title="Óraállások">
        {METER_IDS.map((m) => {
          const meter = METERS[m];
          const prev = history.previous(m, year, month);
          const cons = history.consumption(m, year, month);
          const win = m === 'gas' ? gasWindow : m === 'electricity' ? elWindow : undefined;
          return (
            <div class="entry-row" key={m} style={{ '--cat': `var(--c-${m})` }}>
              <Field
                label={`${meter.label} (${meter.unit})`}
                error={errors[m]}
                hint={
                  <>
                    {prev ? `Előző: ${formatNumber(prev.value)} (${formatDate(prev.date)})` : 'Nincs előző óraállás'}
                    {cons && record.readings[m] && (
                      <>
                        {' · '}fogyasztás: <strong>{formatQuantity(cons.value, meter.unit)}</strong>
                        {cons.estimated && ' (becsült)'}
                      </>
                    )}
                    {win && ` · leolvasás: ${win.start.slice(5).replace('-', '.')}–${win.end.slice(5).replace('-', '.')}`}
                  </>
                }
              >
                <div class="input-pair">
                  <input
                    type="text"
                    inputMode="decimal"
                    autocomplete="off"
                    aria-label={`${meter.label} óraállás`}
                    value={draft.readings[m].value}
                    onInput={(e) => update((d) => void (d.readings[m].value = (e.target as HTMLInputElement).value))}
                  />
                  <input
                    type="date"
                    aria-label={`${meter.label} leolvasás dátuma`}
                    value={draft.readings[m].date}
                    onInput={(e) => update((d) => void (d.readings[m].date = (e.target as HTMLInputElement).value))}
                  />
                </div>
              </Field>
            </div>
          );
        })}
      </Card>

      <Card title="Gáz diktálás" class="cat-gas">
        <Field
          label="Diktált óraállás (m³)"
          error={errors.gasReported}
          hint={`Diktálási ablak: ${gasWindow.start.slice(5).replace('-', '.')}–${gasWindow.end.slice(5).replace('-', '.')}`}
        >
          <div class="input-pair">
            <input
              type="text"
              inputMode="decimal"
              autocomplete="off"
              aria-label="Diktált gázóra-állás"
              placeholder={suggestion ? formatNumber(suggestion.value) : ''}
              value={draft.reported.value}
              onInput={(e) => update((d) => void (d.reported.value = (e.target as HTMLInputElement).value))}
            />
            <input
              type="date"
              aria-label="Diktálás dátuma"
              value={draft.reported.date}
              onInput={(e) => update((d) => void (d.reported.date = (e.target as HTMLInputElement).value))}
            />
          </div>
        </Field>
        {suggestion ? (
          <div class="suggestion">
            <div>
              Javasolt: <strong>{formatQuantity(suggestion.value, 'm³', 0)}</strong>
              <span class="muted">
                {' '}
                (előző diktált {formatNumber(suggestion.previousReported)} + jelleggörbe {formatNumber(suggestion.profile)}
                {suggestion.cappedByActual && ', a tényleges óraállásra korlátozva'})
              </span>
            </div>
            {suggestion.deficitAfter !== undefined && (
              <div class="muted">Diktálás után nem diktált: {formatQuantity(suggestion.deficitAfter, 'm³')}</div>
            )}
            {suggestion.deficitWarning && (
              <div>
                <Badge tone="warn">Figyelem</Badge> Az eltérés nagyobb, mint az év hátralévő jelleggörbéje ({formatQuantity(suggestion.remainingProfile, 'm³')}).
              </div>
            )}
            {parseNumberInput(draft.reported.value) !== suggestion.value && (
              <button type="button" class="btn btn-small btn-secondary" onClick={() => update((d) => void (d.reported.value = String(suggestion.value)))}>
                Javasolt érték beírása
              </button>
            )}
          </div>
        ) : (
          <p class="muted">Javaslathoz kell egy korábbi diktált érték és a havi jelleggörbe (Beállítások).</p>
        )}
      </Card>

      <Card title="Számlák">
        {BILL_IDS.map((b) => (
          <div class="entry-row bill-row" key={b} style={{ '--cat': `var(--c-${b})` }}>
            <Field label={`${BILLS[b].label} (Ft)`} error={errors[`bill-${b}`]}>
              <div class="input-pair">
                <input
                  type="text"
                  inputMode="numeric"
                  autocomplete="off"
                  aria-label={`${BILLS[b].label} fizetendő`}
                  value={draft.bills[b].amount}
                  onInput={(e) => update((d) => void (d.bills[b].amount = (e.target as HTMLInputElement).value))}
                />
                <label class="switch">
                  <input
                    type="checkbox"
                    checked={draft.bills[b].paid}
                    onChange={(e) => update((d) => void (d.bills[b].paid = (e.target as HTMLInputElement).checked))}
                  />
                  <span>Fizetve</span>
                </label>
              </div>
            </Field>
            {parseNumberInput(draft.bills[b].amount) !== undefined && !draft.bills[b].paid && (
              <Field label="Határidő">
                <input
                  type="date"
                  aria-label={`${BILLS[b].label} fizetési határidő`}
                  value={draft.bills[b].dueDate}
                  onInput={(e) => update((d) => void (d.bills[b].dueDate = (e.target as HTMLInputElement).value))}
                />
              </Field>
            )}
          </div>
        ))}
      </Card>

      <Card title="Megjegyzés">
        <textarea
          rows={3}
          aria-label="Megjegyzés"
          value={draft.note}
          onInput={(e) => update((d) => void (d.note = (e.target as HTMLTextAreaElement).value))}
        />
      </Card>

      {(checks.length > 0 || serverError) && (
        <Card title="Ellenőrzés">
          {serverError && <p class="text-bad">{serverError}</p>}
          <Checks checks={checks} />
        </Card>
      )}

      <div class="save-bar">
        <span class="muted">{dirty ? 'Mentetlen módosítások' : 'Nincs módosítás'}</span>
        <button type="submit" class="btn" disabled={saving || !dirty || Object.keys(errors).length > 0}>
          {saving ? 'Mentés…' : hasErrors ? 'Mentés (hibával)' : 'Mentés'}
        </button>
      </div>
    </form>
  );
}
