import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { view: 'overview' }
  | { view: 'entry'; year?: number; month?: number }
  | { view: 'table'; year?: number }
  | { view: 'charts'; year?: number }
  | { view: 'settings' };

const SEGMENTS: Record<string, Route['view']> = {
  '': 'overview',
  attekintes: 'overview',
  rogzites: 'entry',
  tablazat: 'table',
  grafikonok: 'charts',
  beallitasok: 'settings',
};

/** Parses `#/rogzites/2026-10`, `#/rogzites?month=2026-10`, `#/tablazat/2026`, ... */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const [first = '', second = ''] = pathPart.split('/');
  const view = SEGMENTS[first] ?? 'overview';
  const param = second || new URLSearchParams(query).get('month') || new URLSearchParams(query).get('year') || '';
  const ym = /^(\d{4})(?:-(\d{1,2}))?$/.exec(param);
  const year = ym ? Number(ym[1]) : undefined;
  const month = ym?.[2] ? Number(ym[2]) : undefined;
  switch (view) {
    case 'entry':
      return { view, year, month };
    case 'table':
    case 'charts':
      return { view, year };
    default:
      return { view } as Route;
  }
}

export function href(route: Route): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (route.view) {
    case 'overview':
      return '#/';
    case 'entry':
      return route.year && route.month ? `#/rogzites/${route.year}-${pad(route.month)}` : '#/rogzites';
    case 'table':
      return route.year ? `#/tablazat/${route.year}` : '#/tablazat';
    case 'charts':
      return route.year ? `#/grafikonok/${route.year}` : '#/grafikonok';
    case 'settings':
      return '#/beallitasok';
  }
}

export function navigate(route: Route): void {
  location.hash = href(route).slice(1);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/**
 * Deep links from notifications arrive as a path (`<ingress base>/rogzites/2026-10`) because the
 * HA frontend forwards sub-paths of an Ingress panel. Turn them into hash routes on the base URL
 * so that relative URLs keep working and in-app navigation never reloads the page.
 */
export function normalizeDeepLink(): void {
  const basePath = new URL(document.baseURI).pathname.replace(/[^/]*$/, '');
  const path = location.pathname;
  if (!path.startsWith(basePath)) return;
  const rest = path.slice(basePath.length).replace(/\/$/, '');
  if (!rest || rest === 'index.html') return;
  const [first] = rest.split('/');
  if (!(first in SEGMENTS)) return;
  history.replaceState(null, '', `${basePath}${location.search}#/${rest}`);
}
