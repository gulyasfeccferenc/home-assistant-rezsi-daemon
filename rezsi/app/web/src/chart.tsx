import { useEffect, useRef, useState } from 'preact/hooks';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { formatNumber } from '@rezsi/shared';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

export function useDarkMode(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Theme tokens for charts, read from CSS custom properties. */
export function chartTheme() {
  return {
    text: cssVar('--text-2'),
    grid: cssVar('--grid'),
    surface: cssVar('--surface'),
    neutral: cssVar('--series-neutral'),
  };
}

export function ChartCanvas({ config, height = 220, label }: { config: ChartConfiguration; height?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dark = useDarkMode();
  useEffect(() => {
    if (!ref.current) return;
    const t = chartTheme();
    Chart.defaults.color = t.text;
    Chart.defaults.borderColor = t.grid;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const chart = new Chart(ref.current, config);
    return () => chart.destroy();
  }, [config, dark]);
  return (
    <div class="chart" style={{ height: `${height}px` }}>
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}

export const numberTick = (v: number | string) => formatNumber(Number(v), 1);
