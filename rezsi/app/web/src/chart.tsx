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
  type Plugin,
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

/** Touch screens (no hover): the phone in the HA app. */
const isTouch = () => matchMedia('(hover: none)').matches;

function hideTooltip(chart: Chart): void {
  if (!chart.tooltip?.getActiveElements().length) return;
  chart.tooltip.setActiveElements([], { x: 0, y: 0 });
  chart.setActiveElements([]);
  chart.update('none');
}

/**
 * Tooltips on touch screens: a tap opens the tooltip, a second tap on the same month closes it
 * (a tap on another month moves it there). Scrolling over a chart never opens one, because only
 * taps (click events) are listened to; see `events` below.
 */
const tapToggle: Plugin = {
  id: 'tapToggle',
  beforeEvent(chart, args) {
    const e = args.event;
    if (e.type !== 'click' || !isTouch()) return;
    const active = chart.tooltip?.getActiveElements() ?? [];
    if (!active.length || !e.native) return;
    const hits = chart.getElementsAtEventForMode(e.native, 'index', { intersect: false }, false);
    if (hits.length && hits[0].index !== active[0].index) return;
    hideTooltip(chart);
    return false;
  },
};

export function ChartCanvas({ config, height = 220, label }: { config: ChartConfiguration; height?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dark = useDarkMode();
  useEffect(() => {
    if (!ref.current) return;
    const t = chartTheme();
    Chart.defaults.color = t.text;
    Chart.defaults.borderColor = t.grid;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const touch = isTouch();
    const chart = new Chart(ref.current, {
      ...config,
      options: {
        ...config.options,
        // Touch: react to taps only (no touchstart/touchmove), so scrolling does not open tooltips.
        events: touch ? ['click'] : ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
        plugins: {
          ...config.options?.plugins,
          tooltip: {
            ...config.options?.plugins?.tooltip,
            // Smaller tooltip on phones so it covers less of the chart.
            ...(touch ? { padding: 6, bodyFont: { size: 12 }, titleFont: { size: 12 }, boxWidth: 10, boxHeight: 10 } : {}),
          },
        },
      },
      plugins: [...(config.plugins ?? []), tapToggle],
    });
    // A tap anywhere outside the chart closes its tooltip too.
    const onOutside = (e: Event) => {
      if (e.target !== ref.current) hideTooltip(chart);
    };
    document.addEventListener('touchstart', onOutside, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onOutside);
      chart.destroy();
    };
  }, [config, dark]);
  return (
    <div class="chart" style={{ height: `${height}px` }}>
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}

export const numberTick = (v: number | string) => formatNumber(Number(v), 1);
