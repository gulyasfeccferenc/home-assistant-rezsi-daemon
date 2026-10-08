import {
  BILLS,
  formatDate,
  formatHuf,
  formatMonthDayRange,
  formatPercent,
  formatQuantity,
  METERS,
  monthName,
  type BillId,
  type MeterDue,
} from '@rezsi/shared';
import { Badge, Card, Checks, type Tone } from '../components';
import { href } from '../router';
import { useApp } from '../state';

const STATUS: Record<MeterDue['status'], { tone: Tone; text: string }> = {
  ok: { tone: 'ok', text: 'Rögzítve' },
  upcoming: { tone: 'muted', text: 'Hamarosan' },
  due: { tone: 'warn', text: 'Esedékes' },
  overdue: { tone: 'bad', text: 'Késésben' },
  unknown: { tone: 'muted', text: 'Nincs adat' },
};

function MeterRow({ due }: { due: MeterDue }) {
  const meter = METERS[due.meter];
  const s = due.meter === 'water' && due.status === 'ok' ? { tone: 'ok' as Tone, text: 'Rendben' } : STATUS[due.status];
  return (
    <li class="meter-row" style={{ '--cat': `var(--c-${due.meter})` }}>
      <div class="meter-main">
        <strong>{meter.label}</strong>
        <Badge tone={s.tone}>{s.text}</Badge>
      </div>
      <div class="meter-detail muted">
        {due.windowStart && due.windowEnd && (
          <span>
            {due.meter === 'water' ? 'Következő leolvasás: ' : 'Ablak: '}
            {formatMonthDayRange(due.windowStart, due.windowEnd)}
          </span>
        )}
        {due.lastReadingDate && <span>Utolsó: {formatDate(due.lastReadingDate)}</span>}
      </div>
      {due.meter === 'gas' && (due.suggestion || due.deficit !== undefined) && (
        <div class="meter-detail">
          {due.suggestion && (
            <span>
              Javasolt diktálás: <strong>{formatQuantity(due.suggestion.value, 'm³', 0)}</strong>
            </span>
          )}
          {due.deficit !== undefined && <span class="muted">Nem diktált: {formatQuantity(due.deficit, 'm³', 0)}</span>}
        </div>
      )}
      {(due.status === 'due' || due.status === 'overdue' || due.status === 'upcoming') && (
        <a class="btn btn-small" href={href({ view: 'entry', year: due.year, month: due.month })}>
          Rögzítés
        </a>
      )}
    </li>
  );
}

export function OverviewView() {
  const { status, today } = useApp();
  if (!status) return null;
  const t = status.totals;
  const [y, m] = today.split('-').map(Number);
  const change = t.lastYearYtd ? ((t.ytd - t.lastYearYtd) / t.lastYearYtd) * 100 : undefined;
  const important = status.checks.filter((c) => c.level !== 'info');

  return (
    <div class="stack">
      <h1 class="page-title">
        Áttekintés <span class="muted">· {formatDate(today)}</span>
      </h1>

      <Card title={`Leolvasások – ${monthName(m, false)}`}>
        <ul class="meter-list">
          {status.meters.map((d) => (
            <MeterRow key={d.meter} due={d} />
          ))}
        </ul>
      </Card>

      <Card title={`Költségek – ${y}`}>
        <div class="stats">
          <div class="stat">
            <span class="stat-label">Év elejétől</span>
            <span class="stat-value">{formatHuf(t.ytd)}</span>
            {t.lastYearYtd !== undefined && (
              <span class="stat-sub muted">
                Tavaly ugyanekkor: {formatHuf(t.lastYearYtd)}
                {change !== undefined && <> ({formatPercent(change)})</>}
              </span>
            )}
          </div>
          <div class="stat">
            <span class="stat-label">Havi átlag</span>
            <span class="stat-value">{formatHuf(t.averagePerMonth)}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Várható éves</span>
            <span class="stat-value">{formatHuf(t.projectedAnnual)}</span>
          </div>
        </div>
      </Card>

      <Card title="Kifizetetlen számlák">
        {status.unpaid.length === 0 ? (
          <p class="muted">Minden számla kifizetve.</p>
        ) : (
          <ul class="plain-list">
            {status.unpaid.map((u) => (
              <li key={`${u.year}-${u.month}-${u.bill}`}>
                <a href={href({ view: 'entry', year: u.year, month: u.month })}>
                  {BILLS[u.bill as BillId]?.label ?? u.bill} · {u.year}. {monthName(u.month, false)}
                </a>
                <span class="num">{formatHuf(u.amount)}</span>
                {u.dueDate && (
                  <span class={u.dueDate < today ? 'text-bad' : 'muted'}>
                    {u.dueDate < today ? 'Lejárt: ' : 'Határidő: '}
                    {formatDate(u.dueDate)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Figyelmeztetések">
        <Checks checks={important} empty="Nincs figyelmeztetés." />
      </Card>
    </div>
  );
}
