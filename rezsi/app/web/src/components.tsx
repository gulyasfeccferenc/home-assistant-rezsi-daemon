import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatDate, monthName, parseDateInput, type Check } from '@rezsi/shared';

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

export function Checks({ checks, empty, onDismiss }: { checks: Check[]; empty?: string; onDismiss?: (c: Check) => void }) {
  if (!checks.length) return empty ? <p class="muted">{empty}</p> : null;
  return (
    <ul class="checks">
      {checks.map((c, i) => (
        <li key={`${c.code}-${c.year}-${c.month}-${c.category}-${i}`} class={`check check-${c.level}`}>
          <Badge tone={c.level === 'error' ? 'bad' : c.level === 'warning' ? 'warn' : 'info'}>
            {c.level === 'error' ? 'Hiba' : c.level === 'warning' ? 'Figyelem' : 'Infó'}
          </Badge>
          <span class="check-text">{c.message}</span>
          {onDismiss && (
            <button type="button" class="icon-btn icon-btn-small" aria-label={`Figyelmeztetés törlése: ${c.message}`} title="Törlés" onClick={() => onDismiss(c)}>
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Date field that always shows and accepts year.month.day (`2026.10.08.`), independent of the
 * device locale. A calendar button opens the native picker (a transparent native date input
 * laid over the button, so it works on iOS too). `onChange` gets `YYYY-MM-DD`, '' when empty,
 * or 'invalid' while the typed text is not a valid date.
 */
export function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [text, setText] = useState(value && value !== 'invalid' ? formatDate(value) : '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current && value !== 'invalid') setText(value ? formatDate(value) : '');
  }, [value]);
  const parsed = parseDateInput(text);
  return (
    <div class={`date-input ${parsed === null ? 'invalid' : ''}`}>
      <input
        type="text"
        inputMode="numeric"
        autocomplete="off"
        placeholder="éééé.hh.nn."
        aria-label={label}
        aria-invalid={parsed === null}
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          const p = parseDateInput(text);
          if (p) setText(formatDate(p));
        }}
        onInput={(e) => {
          const t = (e.target as HTMLInputElement).value;
          setText(t);
          const p = parseDateInput(t);
          onChange(p === null ? 'invalid' : p ?? '');
        }}
      />
      <span class="date-picker" aria-hidden="true">
        📅
        <input
          type="date"
          tabIndex={-1}
          value={value && value !== 'invalid' ? value : ''}
          onClick={(e) => {
            // Desktop browsers only open the picker from their own icon; ask explicitly.
            try {
              (e.target as HTMLInputElement).showPicker?.();
            } catch {
              /* not supported or not allowed */
            }
          }}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setText(v ? formatDate(v) : '');
            onChange(v);
          }}
        />
      </span>
    </div>
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

type ToastState = { text: string; tone: Tone; ms?: number };
let toastSetter: ((t: ToastState | null) => void) | null = null;

export function toast(text: string, tone: Tone = 'ok', ms?: number): void {
  toastSetter?.({ text, tone, ms });
}

export function ToastHost() {
  const [t, setT] = useState<ToastState | null>(null);
  useEffect(() => {
    toastSetter = setT;
    return () => {
      toastSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), t.ms ?? (t.tone === 'bad' ? 6000 : 2500));
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
