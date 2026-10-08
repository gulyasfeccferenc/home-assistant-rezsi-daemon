import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatDate, monthName, type Check } from '@rezsi/shared';

export function Card({ title, children, actions, class: cls }: { title?: ComponentChildren; children: ComponentChildren; actions?: ComponentChildren; class?: string }) {
  return (
    <section class={`card ${cls ?? ''}`}>
      {(title || actions) && (
        <header class="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div class="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

/** Status pill: always icon + text, never color alone. */
export function Badge({ tone, children }: { tone: Tone; children: ComponentChildren }) {
  const icon = { ok: '✓', warn: '!', bad: '✕', info: 'i', muted: '·' }[tone];
  return (
    <span class={`badge badge-${tone}`}>
      <span aria-hidden="true" class="badge-icon">
        {icon}
      </span>
      {children}
    </span>
  );
}

export function Checks({ checks, empty }: { checks: Check[]; empty?: string }) {
  if (!checks.length) return empty ? <p class="muted">{empty}</p> : null;
  return (
    <ul class="checks">
      {checks.map((c, i) => (
        <li key={i} class={`check check-${c.level}`}>
          <Badge tone={c.level === 'error' ? 'bad' : c.level === 'warning' ? 'warn' : 'info'}>
            {c.level === 'error' ? 'Hiba' : c.level === 'warning' ? 'Figyelem' : 'Infó'}
          </Badge>
          <span>{c.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function YearSelect({ years, value, onChange }: { years: number[]; value: number; onChange: (y: number) => void }) {
  return (
    <label class="inline-select">
      <span class="sr-only">Év</span>
      <select value={value} onChange={(e) => onChange(Number((e.target as HTMLSelectElement).value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MonthNav({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const shift = (d: number) => {
    const idx = year * 12 + (month - 1) + d;
    onChange(Math.floor(idx / 12), (idx % 12) + 1);
  };
  return (
    <div class="month-nav">
      <button type="button" class="icon-btn" aria-label="Előző hónap" onClick={() => shift(-1)}>
        ‹
      </button>
      <strong>
        {year}. {monthName(month, false)}
      </strong>
      <button type="button" class="icon-btn" aria-label="Következő hónap" onClick={() => shift(1)}>
        ›
      </button>
    </div>
  );
}

let toastSetter: ((t: { text: string; tone: Tone } | null) => void) | null = null;

export function toast(text: string, tone: Tone = 'ok'): void {
  toastSetter?.({ text, tone });
}

export function ToastHost() {
  const [t, setT] = useState<{ text: string; tone: Tone } | null>(null);
  useEffect(() => {
    toastSetter = setT;
    return () => {
      toastSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), t.tone === 'bad' ? 6000 : 2500);
    return () => clearTimeout(id);
  }, [t]);
  return (
    <div class="toast-host" role="status" aria-live="polite">
      {t && <div class={`toast toast-${t.tone}`}>{t.text}</div>}
    </div>
  );
}

export function DateText({ date }: { date?: string }) {
  return <>{formatDate(date)}</>;
}

export function Spinner() {
  return <div class="spinner" aria-label="Betöltés…" />;
}
