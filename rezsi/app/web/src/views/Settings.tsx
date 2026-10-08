import { useEffect, useState } from 'preact/hooks';
import {
  BILLS,
  BILL_IDS,
  formatDate,
  formatNumber,
  METERS,
  MONTHS,
  monthName,
  parseNumberInput,
  type BillId,
  type Month,
  type MonthlyValues,
  type Tariff,
} from '@rezsi/shared';
import { api, type ImportResult } from '../api';
import { Badge, Card, YearSelect, toast } from '../components';
import { useApp, useYears } from '../state';

const OPTION_LABELS: Record<string, string> = {
  notify_service: 'Értesítési szolgáltatás',
  reminder_time: 'Emlékeztetők időpontja',
  repeat_every_days: 'Ismétlés (naponta)',
  gas_window_start_day: 'Gáz diktálás kezdőnap',
  gas_window_end_day: 'Gáz diktálás utolsó nap',
  electricity_window_start_day: 'Villany leolvasás kezdőnap',
  electricity_window_end_day: 'Villany leolvasás utolsó nap',
  water_interval_days: 'Víz leolvasás gyakorisága (nap)',
  water_window_days: 'Víz leolvasási ablak (nap)',
  yoy_warning_percent: 'Éves összevetés figyelmeztetés (%)',
  publish_entities: 'Entitások közzététele HA-ban',
  export_enabled: 'Havi export',
  export_day: 'Export napja',
  export_time: 'Export időpontja',
  git_repo_url: 'Git tároló',
  git_token: 'Git token',
  git_branch: 'Git ág',
  git_author_name: 'Commit szerző neve',
  git_author_email: 'Commit szerző e-mail',
};

function fmtTime(iso?: string): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return `${formatDate(d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' }))} ${d.toLocaleTimeString('hu-HU', {
    timeZone: 'Europe/Budapest',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function OptionsCard() {
  const { config } = useApp();
  if (!config) return null;
  return (
    <Card title="Bővítmény beállítások">
      <p class="muted small">
        Csak olvasható. Módosítás: Home Assistant → Beállítások → Bővítmények → Rezsi → Konfiguráció. Verzió: {config.version}
        {!config.haConfigured && ' · Home Assistant kapcsolat nincs beállítva (fejlesztői mód)'}
      </p>
      <dl class="kv">
        {Object.entries(config.options).map(([k, v]) => (
          <div key={k}>
            <dt>{OPTION_LABELS[k] ?? k}</dt>
            <dd>{typeof v === 'boolean' ? (v ? 'igen' : 'nem') : String(v ?? '') || '–'}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function ProfileCard() {
  const { history, today, applyYear } = useApp();
  const years = useYears();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const file = history.files.get(year);
  const init = () => ({
    months: Object.fromEntries(MONTHS.map((m) => [m, file?.gasProfile[m] !== undefined ? formatNumber(file.gasProfile[m]!, 3, ' ') : ''])) as Record<number, string>,
    gas: file?.annualTargets?.gas !== undefined ? String(file.annualTargets.gas) : '',
    electricity: file?.annualTargets?.electricity !== undefined ? String(file.annualTargets.electricity) : '',
  });
  const [form, setForm] = useState(init);
  useEffect(() => setForm(init()), [file, year]);
  const total = MONTHS.reduce((s, m) => s + (parseNumberInput(form.months[m]) || 0), 0);

  const save = async () => {
    const gasProfile: MonthlyValues = {};
    for (const m of MONTHS) {
      const v = parseNumberInput(form.months[m]);
      if (v === undefined) continue;
      if (Number.isNaN(v) || v < 0) return toast(`${monthName(m)}: érvénytelen szám`, 'bad');
      gasProfile[m as Month] = v;
    }
    const target = (s: string) => {
      const v = parseNumberInput(s);
      return v === undefined || Number.isNaN(v) ? undefined : v;
    };
    try {
      const res = await api.saveProfile(year, { gasProfile, annualTargets: { gas: target(form.gas), electricity: target(form.electricity) } });
      applyYear(res.file);
      toast('Jelleggörbe mentve');
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };

  return (
    <Card title="Gázfogyasztási jelleggörbe és éves célok" actions={<YearSelect years={[...new Set([...years, years[years.length - 1] + 1])]} value={year} onChange={setYear} />}>
      <p class="muted small">Havonta diktálható gázmennyiség (m³). Ebből számolódik a javasolt diktált óraállás.</p>
      <div class="profile-grid">
        {MONTHS.map((m) => (
          <label key={m} class="field">
            <span class="field-label">{monthName(m)}</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.months[m]}
              onInput={(e) => setForm({ ...form, months: { ...form.months, [m]: (e.target as HTMLInputElement).value } })}
            />
          </label>
        ))}
      </div>
      <p class="small">
        Összesen: <strong>{formatNumber(total)} m³</strong>
      </p>
      <div class="profile-grid">
        <label class="field">
          <span class="field-label">Éves gáz cél (m³)</span>
          <input type="text" inputMode="decimal" value={form.gas} onInput={(e) => setForm({ ...form, gas: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field">
          <span class="field-label">Éves áram cél (kWh)</span>
          <input
            type="text"
            inputMode="decimal"
            value={form.electricity}
            onInput={(e) => setForm({ ...form, electricity: (e.target as HTMLInputElement).value })}
          />
        </label>
      </div>
      <button type="button" class="btn" onClick={() => void save()}>
        Mentés
      </button>
    </Card>
  );
}

function TariffsCard() {
  const { data, reload } = useApp();
  const [rows, setRows] = useState<Tariff[]>(data?.tariffs ?? []);
  useEffect(() => setRows(data?.tariffs ?? []), [data]);
  const set = (i: number, patch: Partial<Tariff>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const numOrUndef = (s: string) => {
    const v = parseNumberInput(s);
    return v === undefined || Number.isNaN(v) ? undefined : v;
  };
  const save = async () => {
    try {
      const clean = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== '')) as unknown as Tariff);
      await api.saveTariffs(clean);
      await reload();
      toast('Tarifák mentve');
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };
  return (
    <Card title="Tarifák">
      <p class="muted small">Tájékoztató adatok (egységár, alapdíj) – a számolások a számlákból dolgoznak.</p>
      {rows.length === 0 && <p class="muted">Nincs rögzített tarifa.</p>}
      {rows.map((r, i) => (
        <div class="tariff-row" key={i}>
          <select aria-label="Tétel" value={r.bill} onChange={(e) => set(i, { bill: (e.target as HTMLSelectElement).value as BillId })}>
            {BILL_IDS.map((b) => (
              <option key={b} value={b}>
                {BILLS[b].label}
              </option>
            ))}
          </select>
          <input type="date" aria-label="Érvényes ettől" value={r.validFrom} onInput={(e) => set(i, { validFrom: (e.target as HTMLInputElement).value })} />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Egységár"
            aria-label="Egységár"
            value={r.unitPrice ?? ''}
            onInput={(e) => set(i, { unitPrice: numOrUndef((e.target as HTMLInputElement).value) })}
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Alapdíj"
            aria-label="Alapdíj"
            value={r.fixedFee ?? ''}
            onInput={(e) => set(i, { fixedFee: numOrUndef((e.target as HTMLInputElement).value) })}
          />
          <input type="text" placeholder="Megjegyzés" aria-label="Megjegyzés" value={r.note ?? ''} onInput={(e) => set(i, { note: (e.target as HTMLInputElement).value || undefined })} />
          <button type="button" class="icon-btn" aria-label="Törlés" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div class="btn-row">
        <button
          type="button"
          class="btn btn-secondary"
          onClick={() => setRows([...rows, { bill: 'gas', validFrom: new Date().toISOString().slice(0, 10) }])}
        >
          Új tarifa
        </button>
        <button type="button" class="btn" onClick={() => void save()}>
          Mentés
        </button>
      </div>
    </Card>
  );
}

function ExportCard() {
  const { status, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const e = status?.export;
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.exportNow();
      toast(r.commit ? `Exportálva (${r.commit})${r.pushed ? ', feltöltve' : ''}` : 'Nem volt változás');
    } catch (err) {
      toast(`Export hiba: ${(err as Error).message}`, 'bad');
    } finally {
      setBusy(false);
      await reload();
    }
  };
  return (
    <Card title="Export (git)">
      <dl class="kv">
        <div>
          <dt>Havi export</dt>
          <dd>{e?.enabled ? 'bekapcsolva' : 'kikapcsolva'}</dd>
        </div>
        <div>
          <dt>Távoli tároló</dt>
          <dd>{e?.remoteConfigured ? 'beállítva' : 'nincs (csak helyi mentés)'}</dd>
        </div>
        <div>
          <dt>Utolsó futás</dt>
          <dd>{fmtTime(e?.lastRunAt)}</dd>
        </div>
        <div>
          <dt>Utolsó sikeres</dt>
          <dd>{fmtTime(e?.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt>Utolsó commit</dt>
          <dd>{e?.lastCommit ? `${e.lastCommit} – ${e.lastCommitMessage ?? ''}` : '–'}</dd>
        </div>
        <div>
          <dt>Utolsó feltöltés</dt>
          <dd>{fmtTime(e?.lastPushAt)}</dd>
        </div>
      </dl>
      {e?.lastError && (
        <p class="text-bad">
          <Badge tone="bad">Hiba</Badge> {e.lastError}
        </p>
      )}
      <button type="button" class="btn" disabled={busy} onClick={() => void run()}>
        {busy ? 'Exportálás…' : 'Exportálás most'}
      </button>
    </Card>
  );
}

function NotifyCard() {
  const { status, config } = useApp();
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const r = await api.testNotify();
      toast(r.dryRun ? 'Teszt értesítés naplózva (próbamód)' : 'Teszt értesítés elküldve');
    } catch (err) {
      toast(`Értesítés hiba: ${(err as Error).message}`, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const sends = Object.entries(status?.reminders ?? {})
    .flatMap(([meter, r]) => (r?.history ?? []).map((h) => ({ meter, ...h })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
  return (
    <Card title="Értesítések">
      <p class="muted small">
        Szolgáltatás: notify.{String(config?.options.notify_service ?? '')} · utolsó ellenőrzés: {fmtTime(status?.lastReminderCheck)}
      </p>
      {sends.length > 0 && (
        <ul class="plain-list small">
          {sends.map((s, i) => (
            <li key={i}>
              <span>{formatDate(s.date)}</span>
              <span>{METERS[s.meter as keyof typeof METERS]?.label ?? s.meter}</span>
              <span class="muted">{s.message}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" class="btn btn-secondary" disabled={busy} onClick={() => void test()}>
        Teszt értesítés
      </button>
    </Card>
  );
}

function ImportCard() {
  const { reload } = useApp();
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<ImportResult>();
  const [busy, setBusy] = useState(false);
  const run = async (apply: boolean) => {
    if (!file) return;
    if (apply && !confirm(`A(z) ${result?.years.join(', ')} év(ek) adatai felülíródnak (a régi fájlokról mentés készül). Folytatod?`)) return;
    setBusy(true);
    try {
      const r = await api.importSheet(file, apply);
      setResult(r);
      if (apply) {
        await reload();
        toast('Importálva');
      }
    } catch (err) {
      toast(`Import hiba: ${(err as Error).message}`, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Egyszeri import (Google Sheet xlsx)">
      <p class="muted small">
        A táblázat exportja xlsx-ként („2025 - Rezsi”, „2026 - Rezsi” lapok). Előbb előnézet, utána importálás. A „Fa” sor kimarad.
      </p>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          setFile((e.target as HTMLInputElement).files?.[0]);
          setResult(undefined);
        }}
      />
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" disabled={!file || busy} onClick={() => void run(false)}>
          Előnézet
        </button>
        <button type="button" class="btn" disabled={!file || busy || !result || result.applied} onClick={() => void run(true)}>
          Importálás
        </button>
      </div>
      {result && (
        <div class="import-result">
          {result.applied && <Badge tone="ok">Importálva</Badge>}
          <ul class="small">
            {result.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {result.warnings.length > 0 && (
            <ul class="small">
              {result.warnings.map((w) => (
                <li key={w}>
                  <Badge tone="warn">Figyelem</Badge> {w}
                </li>
              ))}
            </ul>
          )}
          <h3>Eltérések ({result.mismatches.length})</h3>
          {result.mismatches.length === 0 ? (
            <p class="muted">Az újraszámolt értékek egyeznek a táblázattal.</p>
          ) : (
            <div class="table-wrap">
              <table class="simple">
                <thead>
                  <tr>
                    <th>Hónap</th>
                    <th>Sor</th>
                    <th>Táblázat</th>
                    <th>Számolt</th>
                  </tr>
                </thead>
                <tbody>
                  {result.mismatches.map((m, i) => (
                    <tr key={i}>
                      <td>
                        {m.year}. {m.month ? monthName(m.month, false) : ''}
                      </td>
                      <td>{m.row}</td>
                      <td class="num">{formatNumber(m.sheet)}</td>
                      <td class="num">{m.computed === undefined ? '–' : formatNumber(m.computed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function SettingsView() {
  return (
    <div class="stack">
      <h1 class="page-title">Beállítások</h1>
      <ProfileCard />
      <ExportCard />
      <NotifyCard />
      <TariffsCard />
      <ImportCard />
      <OptionsCard />
    </div>
  );
}
