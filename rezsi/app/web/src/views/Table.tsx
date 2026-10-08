import { useMemo } from 'preact/hooks';
import {
  computeYear,
  formatDate,
  formatNumber,
  formatPercent,
  METERS,
  METER_IDS,
  MONTHS,
  monthName,
  type BillId,
  type ComputedMonth,
  type MeterId,
} from '@rezsi/shared';
import { YearSelect } from '../components';
import { href, navigate, type Route } from '../router';
import { useApp, useYears } from '../state';

type Cell = { v?: number; estimated?: boolean; tone?: 'warn' | 'good'; title?: string; decimals?: number; text?: string };

interface Row {
  label: string;
  cat?: MeterId | BillId | 'total';
  /** Two cells per month: reading/quantity and payable. */
  cells: (m: number) => [Cell, Cell];
  total?: [Cell, Cell];
  strong?: boolean;
}

function CellView({ c, money }: { c: Cell; money?: boolean }) {
  if (c.text) return <td class="num">{c.text}</td>;
  if (c.v === undefined) return <td class="num empty">–</td>;
  return (
    <td class={`num ${c.estimated ? 'estimated' : ''} ${c.tone ? `tone-${c.tone}` : ''}`} title={c.title}>
      {formatNumber(c.v, c.decimals ?? (money ? 0 : 2))}
      {c.estimated && <span class="sr-only"> (becsült)</span>}
    </td>
  );
}

export function TableView({ route }: { route: Extract<Route, { view: 'table' }> }) {
  const { history, config, today } = useApp();
  const years = useYears();
  const year = route.year ?? Number(today.slice(0, 4));
  const cfg = config!.calc;
  const computed = useMemo(() => computeYear(history, year, cfg, today), [history, year, cfg, today]);
  const file = history.files.get(year);
  const rec = (m: number) => history.record(year, m);
  const cm = (m: number): ComputedMonth => computed.months[m - 1];
  const bill = (m: number, id: BillId): Cell => {
    const b = rec(m)?.bills[id];
    return b ? { v: b.amount, title: b.paid ? 'Fizetve' : 'Nincs fizetve', tone: b.paid ? undefined : 'warn' } : {};
  };
  const t = computed.totals;
  const none: Cell = {};

  const rows: (Row | string)[] = [
    { label: 'Gáz', cat: 'gas', cells: (m) => [{ v: rec(m)?.readings.gas?.value }, bill(m, 'gas')], total: [none, { v: t.byBill.gas }] },
    { label: 'Gáz diktált', cat: 'gas', cells: (m) => [{ v: rec(m)?.gasReported?.value }, none] },
    { label: 'Villany', cat: 'electricity', cells: (m) => [{ v: rec(m)?.readings.electricity?.value }, bill(m, 'electricity')], total: [none, { v: t.byBill.electricity }] },
    { label: 'Telekom', cat: 'telecom', cells: (m) => [none, bill(m, 'telecom')], total: [none, { v: t.byBill.telecom }] },
    { label: 'Víz', cat: 'water', cells: (m) => [{ v: rec(m)?.readings.water?.value }, bill(m, 'water')], total: [none, { v: t.byBill.water }] },
    { label: 'Szemétszállítás', cat: 'waste', cells: (m) => [none, bill(m, 'waste')], total: [none, { v: t.byBill.waste }] },
    { label: 'Összesen', cat: 'total', strong: true, cells: (m) => [none, { v: cm(m).total }], total: [none, { v: t.ytd }] },
    'Fogyasztás',
    ...METER_IDS.map(
      (meter): Row => ({
        label: `${METERS[meter].label} (${METERS[meter].unit})`,
        cat: meter,
        cells: (m) => {
          const c = cm(m).consumption[meter];
          const y = cm(m).yoy[meter];
          return [
            {
              v: c?.value,
              estimated: c?.estimated,
              decimals: 1,
              tone: y?.status === 'warn' ? 'warn' : y?.status === 'good' ? 'good' : undefined,
              title: y ? `Tavalyhoz képest: ${formatPercent(y.percent)}` : undefined,
            },
            none,
          ];
        },
        total: [{ v: t.consumption[meter], decimals: 1 }, none],
      }),
    ),
    { label: 'Gáz diktált fogy. (m³)', cat: 'gas', cells: (m) => [{ v: cm(m).billedGas?.value, decimals: 1 }, none], total: [{ v: t.billedGas, decimals: 1 }, none] },
    'Tavaly',
    ...METER_IDS.map(
      (meter): Row => ({
        label: `Tavalyi ${METERS[meter].label.toLowerCase()}`,
        cells: (m) => [{ v: cm(m).lastYearConsumption[meter]?.value, estimated: cm(m).lastYearConsumption[meter]?.estimated, decimals: 1 }, none],
      }),
    ),
    { label: 'Tavalyi összesen (Ft)', cells: (m) => [none, { v: cm(m).lastYearTotal }], total: [none, { v: t.lastYearYtd }] },
    'Gáz terv',
    { label: 'Jelleggörbe (m³)', cat: 'gas', cells: (m) => [{ v: file?.gasProfile[m as 1] }, none], total: [{ v: t.gasProfileTotal || undefined }, none] },
    {
      label: 'Nem diktált (m³)',
      cat: 'gas',
      cells: (m) => [{ v: cm(m).gasDeficit, decimals: 0, tone: cm(m).gasSuggestion?.deficitWarning ? 'warn' : undefined }, none],
    },
    ...(file?.annualTargets
      ? [
          {
            label: 'Éves cél',
            cells: () => [none, none] as [Cell, Cell],
            total: [
              {
                text: [
                  file.annualTargets.gas !== undefined ? `gáz ${formatNumber(file.annualTargets.gas)} m³` : '',
                  file.annualTargets.electricity !== undefined ? `áram ${formatNumber(file.annualTargets.electricity)} kWh` : '',
                ]
                  .filter(Boolean)
                  .join(', '),
              },
              none,
            ] as [Cell, Cell],
          },
        ]
      : []),
  ];

  return (
    <div class="stack">
      <div class="entry-head">
        <h1 class="page-title">Táblázat</h1>
        <YearSelect years={years} value={year} onChange={(y) => navigate({ view: 'table', year: y })} />
      </div>
      <p class="muted small">
        Dőlt: becsült (több hónapra elosztott) érték. Kiemelés: a tavalyi azonos hónaphoz képest +{cfg.yoyWarningPercent}% felett / csökkenés.
      </p>
      <div class="table-wrap">
        <table class="sheet">
          <thead>
            <tr>
              <th class="sticky" rowSpan={2}>
                {year}
              </th>
              {MONTHS.map((m) => {
                const r = rec(m);
                const date = r?.readings.gas?.date ?? r?.readings.electricity?.date ?? r?.readings.water?.date;
                return (
                  <th key={m} colSpan={2}>
                    <a href={href({ view: 'entry', year, month: m })}>{monthName(m)}</a>
                    {date && <div class="th-date">{formatDate(date)}</div>}
                  </th>
                );
              })}
              <th colSpan={2}>Összesen</th>
            </tr>
            <tr class="subhead">
              {[...MONTHS, 13].map((m) => [
                <th key={`${m}a`}>{m === 13 ? 'Menny.' : 'Óraállás'}</th>,
                <th key={`${m}b`}>Fizetendő</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) =>
              typeof row === 'string' ? (
                <tr key={i} class="section-row">
                  <th class="sticky">{row}</th>
                  <td colSpan={26} />
                </tr>
              ) : (
                <tr key={i} class={`${row.cat ? `cat cat-${row.cat}` : ''} ${row.strong ? 'strong' : ''}`}>
                  <th class="sticky" scope="row">
                    {row.label}
                  </th>
                  {MONTHS.map((m) => {
                    const [a, b] = row.cells(m);
                    return [<CellView key={`${m}a`} c={a} />, <CellView key={`${m}b`} c={b} money />];
                  })}
                  <CellView c={row.total?.[0] ?? none} />
                  <CellView c={row.total?.[1] ?? none} money />
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
