import { useMemo } from 'preact/hooks';
import type { ChartConfiguration, TooltipItem } from 'chart.js';
import {
  BILLS,
  BILL_IDS,
  computeYear,
  formatHuf,
  formatNumber,
  formatQuantity,
  METERS,
  METER_IDS,
  MONTHS,
  monthName,
  type ComputedYear,
  type History,
  type MeterId,
} from '@rezsi/shared';
import { Card, YearSelect } from '../components';
import { ChartCanvas, chartTheme, numberTick, useDarkMode } from '../chart';
import { navigate, type Route } from '../router';
import { useApp, useYears } from '../state';

const LABELS = MONTHS.map((m) => monthName(m).slice(0, 3));

const color = (id: keyof typeof BILLS, dark: boolean) => (dark ? BILLS[id].colorDark : BILLS[id].color);

function baseOptions(unit: string, stacked = false): ChartConfiguration['options'] {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 2 } },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<'bar' | 'line'>) => {
            const v = item.parsed.y;
            if (v === null || v === undefined) return '';
            const est = (item.dataset as { estimated?: boolean[] }).estimated?.[item.dataIndex] ? ' (becsült)' : '';
            const value = unit === 'Ft' ? formatHuf(v) : formatQuantity(v, unit);
            return `${item.dataset.label}: ${value}${est}`;
          },
        },
      },
    },
    scales: {
      x: { stacked, grid: { display: false } },
      y: { stacked, beginAtZero: true, ticks: { callback: numberTick, maxTicksLimit: 6 }, border: { display: false } },
    },
  };
}

function consumptionChart(c: ComputedYear, meter: MeterId, dark: boolean): ChartConfiguration {
  const t = chartTheme();
  const cur = MONTHS.map((m) => c.months[m - 1].consumption[meter]);
  const last = MONTHS.map((m) => c.months[m - 1].lastYearConsumption[meter]);
  const main = dark ? METERS[meter].colorDark : METERS[meter].color;
  return {
    type: 'bar',
    data: {
      labels: LABELS,
      datasets: [
        {
          label: `${c.year}`,
          data: cur.map((p) => p?.value ?? null),
          // Estimated (spread) months are drawn lighter; the tooltip says so too.
          backgroundColor: cur.map((p) => (p?.estimated ? main + '73' : main)),
          estimated: cur.map((p) => !!p?.estimated),
          borderRadius: 4,
          borderSkipped: 'start',
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        } as never,
        {
          label: `${c.year - 1}`,
          data: last.map((p) => p?.value ?? null),
          backgroundColor: t.neutral,
          estimated: last.map((p) => !!p?.estimated),
          borderRadius: 4,
          borderSkipped: 'start',
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        } as never,
      ],
    },
    options: baseOptions(METERS[meter].unit),
  };
}

function costChart(c: ComputedYear, history: History, dark: boolean): ChartConfiguration {
  const t = chartTheme();
  return {
    type: 'bar',
    data: {
      labels: LABELS,
      datasets: BILL_IDS.map((id) => ({
        label: BILLS[id].label,
        data: MONTHS.map((m) => history.record(c.year, m)?.bills[id]?.amount ?? null),
        backgroundColor: color(id, dark),
        // A surface-colored border gives the 2px gap between stacked segments.
        borderColor: t.surface,
        borderWidth: { top: 2 },
        borderSkipped: 'start',
      })),
    },
    options: baseOptions('Ft', true),
  };
}

function unitPriceChart(c: ComputedYear, prev: ComputedYear, meter: MeterId, dark: boolean): ChartConfiguration {
  const t = chartTheme();
  const main = dark ? METERS[meter].colorDark : METERS[meter].color;
  const line = (data: (number | undefined)[], label: string, col: string) => ({
    label,
    data: data.map((v) => v ?? null),
    borderColor: col,
    backgroundColor: col,
    borderWidth: 2,
    pointRadius: 4,
    pointHoverRadius: 6,
    spanGaps: true,
  });
  const unit = `Ft/${METERS[meter].unit}`;
  const opts = baseOptions(unit);
  opts!.plugins!.tooltip!.callbacks!.label = (item: TooltipItem<'line'>) =>
    item.parsed.y == null ? '' : `${item.dataset.label}: ${formatNumber(item.parsed.y, 1)} ${unit}`;
  return {
    type: 'line',
    data: {
      labels: LABELS,
      datasets: [
        line(MONTHS.map((m) => c.months[m - 1].unitPrice[meter]), `${c.year}`, main),
        line(MONTHS.map((m) => prev.months[m - 1].unitPrice[meter]), `${c.year - 1}`, t.neutral),
      ],
    },
    options: opts as never,
  };
}

/** Cumulative gas: actual reading, reported reading and the plan (start + cumulative profile). */
function gasPlanChart(c: ComputedYear, history: History, dark: boolean): ChartConfiguration {
  const t = chartTheme();
  const year = c.year;
  const start = history.previous('gasReported', year, 1)?.value;
  let acc = start;
  const plan = MONTHS.map((m) => {
    const p = history.files.get(year)?.gasProfile[m];
    if (acc === undefined || p === undefined) return null;
    acc += p;
    return acc;
  });
  const gas = dark ? METERS.gas.colorDark : METERS.gas.color;
  const ds = (label: string, data: (number | null)[], col: string, dash?: number[]) => ({
    label,
    data,
    borderColor: col,
    backgroundColor: col,
    borderWidth: 2,
    borderDash: dash,
    pointRadius: 4,
    pointHoverRadius: 6,
    spanGaps: true,
  });
  const opts = baseOptions('m³');
  (opts!.scales!.y as { beginAtZero: boolean }).beginAtZero = false;
  return {
    type: 'line',
    data: {
      labels: LABELS,
      datasets: [
        ds('Tényleges', MONTHS.map((m) => history.reading('gas', year, m)?.value ?? null), gas),
        ds('Diktált', MONTHS.map((m) => history.reading('gasReported', year, m)?.value ?? null), color('telecom', dark)),
        ds('Terv (jelleggörbe)', plan, t.neutral, [6, 4]),
      ],
    },
    options: opts as never,
  };
}

export function ChartsView({ route }: { route: Extract<Route, { view: 'charts' }> }) {
  const { history, config, today } = useApp();
  const years = useYears();
  const dark = useDarkMode();
  const year = route.year ?? Number(today.slice(0, 4));
  const cfg = config!.calc;
  const c = useMemo(() => computeYear(history, year, cfg, today), [history, year, cfg, today]);
  const prev = useMemo(() => computeYear(history, year - 1, cfg, today), [history, year, cfg, today]);
  const configs = useMemo(
    () => ({
      consumption: METER_IDS.map((m) => consumptionChart(c, m, dark)),
      cost: costChart(c, history, dark),
      unit: METER_IDS.map((m) => unitPriceChart(c, prev, m, dark)),
      gas: gasPlanChart(c, history, dark),
    }),
    [c, prev, history, dark],
  );

  return (
    <div class="stack">
      <div class="entry-head">
        <h1 class="page-title">Grafikonok</h1>
        <YearSelect years={years} value={year} onChange={(y) => navigate({ view: 'charts', year: y })} />
      </div>
      <p class="muted small">Pontos értékek a Táblázat nézetben. A halványabb oszlop becsült (több hónapra elosztott) fogyasztás.</p>
      <div class="grid-2">
        {METER_IDS.map((m, i) => (
          <Card key={m} title={`${METERS[m].label} fogyasztás (${METERS[m].unit})`}>
            <ChartCanvas config={configs.consumption[i]} label={`${METERS[m].label} havi fogyasztás, ${year} és ${year - 1}`} />
          </Card>
        ))}
        <Card title="Gáz: tényleges, diktált és terv (óraállás, m³)">
          <ChartCanvas config={configs.gas} label="Gáz óraállás: tényleges, diktált és jelleggörbe szerinti terv" />
        </Card>
      </div>
      <Card title="Költségek kategóriánként (Ft)">
        <ChartCanvas config={configs.cost} height={280} label={`Havi költségek kategóriánként, ${year}`} />
      </Card>
      <div class="grid-3">
        {METER_IDS.map((m, i) => (
          <Card key={m} title={`${METERS[m].label} egységár (Ft/${METERS[m].unit})`}>
            <ChartCanvas config={configs.unit[i]} height={180} label={`${METERS[m].label} egységár havonta`} />
          </Card>
        ))}
      </div>
    </div>
  );
}
