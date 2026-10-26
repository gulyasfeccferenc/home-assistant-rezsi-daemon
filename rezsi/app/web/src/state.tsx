import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { checkKey, History, today as todayIn, type Check, type YearFile } from '@rezsi/shared';
import { api, type ConfigResponse, type DataResponse, type StatusResponse } from './api';

export interface AppState {
  config?: ConfigResponse;
  data?: DataResponse;
  status?: StatusResponse;
  history: History;
  today: string;
  error?: string;
  loading: boolean;
  reload: () => Promise<void>;
  /** Replace year files locally after a save (then refresh status in the background). */
  applyYear: (file: YearFile) => void;
  applyYears: (files: YearFile[]) => void;
  dismissed: Set<string>;
  /** Deletes (hides) a warning; it does not come back unless restored in Beállítások. */
  dismissCheck: (check: Check) => Promise<void>;
  restoreChecks: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: preact.ComponentChildren }) {
  const [config, setConfig] = useState<ConfigResponse>();
  const [data, setData] = useState<DataResponse>();
  const [status, setStatus] = useState<StatusResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [c, d, s] = await Promise.all([api.config(), api.data(), api.status()]);
      setConfig(c);
      setData(d);
      setStatus(s);
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const applyYears = useCallback((files: YearFile[]) => {
    setData((d) => {
      if (!d) return d;
      const byYear = new Map(d.years.map((y) => [y.year, y]));
      for (const f of files) byYear.set(f.year, f);
      return { ...d, years: [...byYear.values()].sort((a, b) => a.year - b.year) };
    });
    void api.status().then(setStatus).catch(() => undefined);
  }, []);
  const applyYear = useCallback((file: YearFile) => applyYears([file]), [applyYears]);

  const setDismissed = (keys: string[]) => {
    setData((d) => (d ? { ...d, dismissedChecks: keys } : d));
    void api.status().then(setStatus).catch(() => undefined);
  };
  const dismissCheck = useCallback(async (check: Check) => {
    const key = checkKey(check);
    // Hide immediately; the server filters it from the next status as well.
    setStatus((s) => (s ? { ...s, checks: s.checks.filter((c) => checkKey(c) !== key) } : s));
    setDismissed((await api.dismissChecks([key])).dismissedChecks);
  }, []);
  const restoreChecks = useCallback(async () => {
    setDismissed((await api.restoreChecks()).dismissedChecks);
  }, []);

  const history = useMemo(() => new History(data?.years ?? []), [data?.years]);
  const dismissed = useMemo(() => new Set(data?.dismissedChecks ?? []), [data?.dismissedChecks]);
  const today = status?.today ?? todayIn();

  return (
    <Ctx.Provider
      value={{ config, data, status, history, today, error, loading, reload, applyYear, applyYears, dismissed, dismissCheck, restoreChecks }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}

/** Years that have data, plus the current year. */
export function useYears(): number[] {
  const { history, today } = useApp();
  const current = Number(today.slice(0, 4));
  return [...new Set([...history.years(), current])].sort((a, b) => a - b);
}
