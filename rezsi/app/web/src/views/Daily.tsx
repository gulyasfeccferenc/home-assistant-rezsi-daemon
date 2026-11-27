import { useMemo, useState } from 'preact/hooks';
import type { ChartConfiguration, TooltipItem } from 'chart.js';
import {
  dailyConsumption,
  formatDate,
  formatNumber,
  formatQuantity,
  METERS,
  parseNumberInput,
  temperatureRegression,
  weeklyIntensity,
  zonedParts,
  zonedToEpoch,
  type DailyGasDay,
  type DailyGasReading,
} from '@rezsi/shared';
import { api } from '../api';
import { ChartCanvas, chartTheme, numberTick, useDarkMode } from '../chart';
import { Badge, Card, ConfirmDialog, DateInput, toast } from '../components';
import { useApp } from '../state';

/** `18:05`, `1805`, `18.05`, `8:5` -> `18:05`; undefined when invalid. */
function parseTime(raw: string): string | undefined {
  const m = /^(\d{1,2})[:.\s]?(\d{2})$/.exec(raw.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

const nowLocal = () => {
  const p = zonedParts();
  return { date: p.date, time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` };
};

const fmtAt = (at: string) => `${formatDate(at.slice(0, 10))} ${at.slice(11)}`;
const m3 = (v: number | undefined, d = 2) => formatQuantity(v, 'm³', d);
const temp = (v: number | undefined) => (v === undefined ? '–' : `${formatNumber(v, 1)} °C`);
const shortDate = (d: string) => `${d.slice(5, 7)}.${d.slice(8)}.`;

function EntryCard() {
  const { daily, setDaily } = useApp();
  const readings = daily?.readings ?? [];
  const last = readings.at(-1);
  const [value, setValue] = useState('');
  const [date, setDate] = useState(() => nowLocal().date);
  const [time, setTime] = useState(() => nowLocal().time);
  // Until the user edits the time, the reading is stamped with the moment of saving.
  const [timeEdited, setTimeEdited] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const v = parseNumberInput(value);
  const t = parseTime(time);
  const valueError = v !== undefined && (Number.isNaN(v) || v < 0) ? 'Érvénytelen szám' : undefined;
  const preview = useMemo(() => {
    if (!last || v === undefined || Number.isNaN(v) || !t || date === 'invalid' || !date) return undefined;
    const hours = (zonedToEpoch(`${date}T${t}`) - zonedToEpoch(last.at)) / 3_600_000;
    if (hours <= 0) return undefined;
    const delta = v - last.value;
    return { hours, delta, perDay: (delta / hours) * 24 };
  }, [last, v, t, date]);

  const save = async (e: Event) => {
    e.preventDefault();
    if (v === undefined || Number.isNaN(v) || !t || !date || date === 'invalid') return;
    const at = timeEdited ? `${date}T${t}` : (() => {
      const n = nowLocal();
      return `${n.date}T${n.time}`;
    })();
    setSaving(true);
    try {
      setDaily(await api.addDaily({ at, value: v }));
      setValue('');
      setError(undefined);
      setTimeEdited(false);
      const n = nowLocal();
      setDate(n.date);
      setTime(n.time);
      toast('Napi leolvasás mentve');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Leolvasás" class="cat-gas">
      <form class="stack-tight" onSubmit={save} noValidate>
        <div class={`field ${valueError ? 'has-error' : ''}`}>
          <span class="field-label">Gázóra-állás (m³)</span>
          <input
            type="text"
            inputMode="decimal"
            autocomplete="off"
            aria-label="Napi gázóra-állás"
            placeholder={last ? formatNumber(last.value, 3) : 'pl. 8 532,417'}
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          />
          {valueError ? (
            <span class="field-error">{valueError}</span>
          ) : (
            <span class="field-hint">
              {last ? `Előző: ${formatNumber(last.value, 3)} m³ (${fmtAt(last.at)})` : 'Ez lesz az első napi leolvasás.'}
              {preview && (
                <>
                  {' · '}+{formatNumber(preview.delta, 3)} m³ {formatNumber(preview.hours, 1)} óra alatt (≈ <strong>{formatNumber(preview.perDay, 2)} m³/nap</strong>)
                </>
              )}
            </span>
          )}
        </div>
        <div class="date-time">
          <DateInput
            label="Leolvasás napja"
            value={date}
            onChange={(d) => {
              setDate(d);
              setTimeEdited(true);
            }}
          />
          <div class={`field ${t ? '' : 'has-error'}`}>
            <input
              type="text"
              inputMode="numeric"
              autocomplete="off"
              aria-label="Leolvasás időpontja (óra:perc)"
              placeholder="óó:pp"
              value={time}
              onInput={(e) => {
                setTime((e.target as HTMLInputElement).value);
                setTimeEdited(true);
              }}
              onBlur={() => t && setTime(t)}
            />
          </div>
        </div>
        <span class="field-hint">{timeEdited ? 'Megadott időpont.' : 'Az időpont mentéskor automatikusan a mostani lesz.'}</span>
        {error && <p class="text-bad">{error}</p>}
        <div class="btn-row">
          <button type="submit" class="btn" disabled={saving || v === undefined || !!valueError || !t || !date || date === 'invalid'}>
            {saving ? 'Mentés…' : 'Mentés'}
          </button>
          {timeEdited && (
            <button
              type="button"
              class="btn btn-secondary"
              onClick={() => {
                const n = nowLocal();
                setDate(n.date);
                setTime(n.time);
                setTimeEdited(false);
              }}
            >
              Most
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}

function SummaryCard({ days, reg, base }: { days: DailyGasDay[]; reg: ReturnType<typeof temperatureRegression>; base: number }) {
  const complete = days.filter((d) => d.complete);
  const lastDay = complete.at(-1);
  const week = complete.slice(-7);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined);
  const weekTemps = week.filter((d) => d.meanTemp !== undefined);
  const weekHdd = weekTemps.reduce((s, d) => s + (d.hdd ?? 0), 0);
  const weekGas = weekTemps.reduce((s, d) => s + d.consumption, 0);
  return (
    <Card title="Összegzés">
      <div class="stats">
        <div class="stat">
          <span class="stat-label">Legutóbbi teljes nap</span>
          <span class="stat-value">{lastDay ? m3(lastDay.consumption) : '–'}</span>
          <span class="stat-sub muted">{lastDay ? `${formatDate(lastDay.date)} · átlag ${temp(lastDay.meanTemp)}` : 'Két leolvasás kell köré.'}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Elmúlt {week.length || 7} nap átlaga</span>
          <span class="stat-value">{week.length ? `${formatNumber(avg(week.map((d) => d.consumption))!, 2)} m³/nap` : '–'}</span>
          <span class="stat-sub muted">{weekTemps.length ? `átlag ${temp(avg(weekTemps.map((d) => d.meanTemp!)))}` : ' '}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Hőmérséklet-függés</span>
          <span class="stat-value">{reg && reg.slope < 0 ? `+${formatNumber(-reg.slope, 2)} m³` : '–'}</span>
          <span class="stat-sub muted">
            {reg
              ? reg.slope < 0
                ? `ennyivel több egy 1 °C-kal hidegebb napon (${reg.n} nap, R² ${formatNumber(reg.r2, 2)})`
                : `még nem látszik összefüggés (${reg.n} nap)`
              : `Legalább 5 teljes nap kell hozzá (most: ${complete.filter((d) => d.meanTemp !== undefined).length}).`}
          </span>
        </div>
        <div class="stat">
          <span class="stat-label">m³ / foknap (elmúlt 7 nap)</span>
          <span class="stat-value">{weekHdd > 0 ? formatNumber(weekGas / weekHdd, 3) : '–'}</span>
          <span class="stat-sub muted">foknap = {formatNumber(base, 1)} °C − napi átlag; tartalmazza a melegvizet és a főzést is</span>
        </div>
      </div>
    </Card>
  );
}

function chartsFor(days: DailyGasDay[], reg: ReturnType<typeof temperatureRegression>, dark: boolean) {
  const t = chartTheme();
  const gas = dark ? METERS.gas.colorDark : METERS.gas.color;
  const shown = days.slice(-60);
  const labels = shown.map((d) => shortDate(d.date));
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: { legend: { display: false } },
  };
  const consumption: ChartConfiguration = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Fogyasztás',
          data: shown.map((d) => d.consumption),
          // Partial days (no reading yet on one side) are drawn lighter.
          backgroundColor: shown.map((d) => (d.complete ? gas : gas + '59')),
          borderRadius: 4,
          borderSkipped: 'start',
        },
      ],
    },
    options: {
      ...common,
      plugins: {
        ...common.plugins,
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<'bar'>) => {
              const d = shown[item.dataIndex];
              return `${m3(d.consumption)}${d.complete ? '' : ' (részleges nap)'}`;
            },
          },
        },
      },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: numberTick, maxTicksLimit: 5 }, border: { display: false } } },
    },
  };
  const temperature: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Napi átlag',
          data: shown.map((d) => d.meanTemp ?? null),
          borderColor: t.neutral,
          backgroundColor: t.neutral,
          borderWidth: 2,
          pointRadius: 3,
          spanGaps: true,
        },
      ],
    },
    options: {
      ...common,
      plugins: { ...common.plugins, tooltip: { callbacks: { label: (item: TooltipItem<'line'>) => temp(item.parsed.y ?? undefined) } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: numberTick, maxTicksLimit: 5 }, border: { display: false } } },
    },
  };
  const pts = days.filter((d) => d.complete && d.meanTemp !== undefined);
  const xs = pts.map((d) => d.meanTemp!);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const scatter: ChartConfiguration = {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Nap',
          data: pts.map((d) => ({ x: d.meanTemp!, y: d.consumption })),
          backgroundColor: gas,
          borderColor: t.surface,
          borderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
        ...(reg
          ? [
              {
                type: 'line' as const,
                label: 'Trend',
                data: [
                  { x: lo, y: reg.intercept + reg.slope * lo },
                  { x: hi, y: reg.intercept + reg.slope * hi },
                ],
                borderColor: t.neutral,
                borderDash: [6, 4],
                borderWidth: 2,
                pointRadius: 0,
              },
            ]
          : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            label: (item: TooltipItem<'scatter'>) => {
              const d = pts[item.dataIndex];
              return `${formatDate(d.date)}: ${m3(d.consumption)}, ${temp(d.meanTemp)}`;
            },
          },
        },
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Napi átlaghőmérséklet (°C)' }, ticks: { callback: numberTick } },
        y: { beginAtZero: true, title: { display: true, text: 'm³ / nap' }, ticks: { callback: numberTick, maxTicksLimit: 5 }, border: { display: false } },
      },
    },
  };
  const weeks = weeklyIntensity(days);
  const weekly: ChartConfiguration = {
    type: 'line',
    data: {
      labels: weeks.map((w) => shortDate(w.week)),
      datasets: [
        {
          label: 'm³ / foknap',
          data: weeks.map((w) => w.perHdd ?? null),
          borderColor: gas,
          backgroundColor: gas,
          borderWidth: 2,
          pointRadius: 4,
          spanGaps: true,
        },
      ],
    },
    options: {
      ...common,
      plugins: {
        ...common.plugins,
        tooltip: {
          callbacks: {
            title: (items) => `Hét: ${formatDate(weeks[items[0].dataIndex].week)}`,
            label: (item: TooltipItem<'line'>) => {
              const w = weeks[item.dataIndex];
              return `${formatNumber(item.parsed.y ?? 0, 3)} m³/foknap (${m3(w.consumption, 1)}, ${formatNumber(w.hdd, 1)} foknap, ${w.days} nap)`;
            },
          },
        },
      },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: numberTick, maxTicksLimit: 5 }, border: { display: false } } },
    },
  };
  return { consumption, temperature, scatter, weekly, hasScatter: pts.length > 0, hasWeeks: weeks.length > 0 };
}

function ReadingsCard({ readings }: { readings: DailyGasReading[] }) {
  const { setDaily } = useApp();
  const [pending, setPending] = useState<DailyGasReading>();
  const recent = [...readings].reverse().slice(0, 15);
  const remove = async (r: DailyGasReading) => {
    setPending(undefined);
    try {
      setDaily(await api.deleteDaily(r.at));
      toast('Leolvasás törölve');
    } catch (err) {
      toast((err as Error).message, 'bad');
    }
  };
  if (!readings.length) return null;
  return (
    <Card title="Leolvasások">
      <ul class="plain-list">
        {recent.map((r) => (
          <li key={r.at}>
            <span>{fmtAt(r.at)}</span>
            <span class="num">{formatNumber(r.value, 3)} m³</span>
            <button type="button" class="icon-btn icon-btn-small" aria-label={`Leolvasás törlése: ${fmtAt(r.at)}`} onClick={() => setPending(r)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {readings.length > recent.length && <p class="muted small">és még {readings.length - recent.length} korábbi leolvasás</p>}
      {pending && (
        <ConfirmDialog title="Leolvasás törlése" confirmLabel="Törlés" onCancel={() => setPending(undefined)} onConfirm={() => void remove(pending)}>
          <p>
            {fmtAt(pending.at)} – {formatNumber(pending.value, 3)} m³
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

export function DailyView() {
  const { daily } = useApp();
  const dark = useDarkMode();
  const base = daily?.baseTemperature ?? 16;
  const { days, problems } = useMemo(
    () => dailyConsumption(daily?.readings ?? [], daily?.temperatures ?? {}, base),
    [daily?.readings, daily?.temperatures, base],
  );
  const reg = useMemo(() => temperatureRegression(days), [days]);
  const charts = useMemo(() => chartsFor(days, reg, dark), [days, reg, dark]);
  const w = daily?.weather;

  return (
    <div class="stack">
      <h1 class="page-title">Napi gáz</h1>
      <EntryCard />
      {problems.map((p) => (
        <div key={p.at} class="banner banner-bad" role="alert">
          {fmtAt(p.at)}: {p.message}
        </div>
      ))}
      {days.length > 0 && (
        <>
          <SummaryCard days={days} reg={reg} base={base} />
          <div class="grid-2">
            <Card title="Napi fogyasztás (m³)">
              <ChartCanvas config={charts.consumption} height={200} label="Napi gázfogyasztás" />
              <p class="muted small">Halványabb: részleges nap (az egyik oldalán még nincs leolvasás).</p>
            </Card>
            <Card title="Napi átlaghőmérséklet (°C)">
              <ChartCanvas config={charts.temperature} height={200} label="Napi átlaghőmérséklet" />
            </Card>
          </div>
          {charts.hasScatter && (
            <Card title="Fogyasztás a hőmérséklet függvényében">
              <ChartCanvas config={charts.scatter} height={240} label="Napi gázfogyasztás a napi átlaghőmérséklet függvényében, trendvonallal" />
            </Card>
          )}
          {charts.hasWeeks && (
            <Card title="Heti m³ / foknap">
              <ChartCanvas config={charts.weekly} height={180} label="Heti gázfogyasztás foknaponként" />
              <p class="muted small">Ha ez nő, ugyanakkora hidegben is több gáz fogy.</p>
            </Card>
          )}
        </>
      )}
      <ReadingsCard readings={daily?.readings ?? []} />
      <p class="muted small">
        Hőmérséklet: {w?.source ?? 'Open-Meteo'}
        {w?.locationName ? ` (${w.locationName})` : w?.latitude !== undefined ? ` (${formatNumber(w.latitude, 3)}, ${formatNumber(w.longitude ?? 0, 3)})` : ''}
        {w?.enabled === false && ' – kikapcsolva'}
        {w?.lastError && (
          <>
            {' '}
            <Badge tone="warn">Hiba</Badge> {w.lastError}
          </>
        )}
        {daily?.reminder.enabled && ` · Emlékeztető: ${daily.reminder.times.join(' és ')}, ha aznap még nincs leolvasás.`}
      </p>
    </div>
  );
}
