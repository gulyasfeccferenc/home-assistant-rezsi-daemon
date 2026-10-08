import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { History, today as todayIn, type YearFile } from '@rezsi/shared';
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
  /** Replace one year file locally after a save (then refresh status in the background). */
  applyYear: (file: YearFile) => void;
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

  const applyYear = useCallback((file: YearFile) => {
    setData((d) => (d ? { ...d, years: [...d.years.filter((y) => y.year !== file.year), file].sort((a, b) => a.year - b.year) } : d));
    void api.status().then(setStatus).catch(() => undefined);
  }, []);

  const history = useMemo(() => new History(data?.years ?? []), [data]);
  const today = status?.today ?? todayIn();

  return (
    <Ctx.Provider value={{ config, data, status, history, today, error, loading, reload, applyYear }}>{children}</Ctx.Provider>
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
