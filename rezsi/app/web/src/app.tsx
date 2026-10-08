import { Spinner, ToastHost } from './components';
import { href, useRoute, type Route } from './router';
import { AppProvider, useApp } from './state';
import { ChartsView } from './views/Charts';
import { EntryView } from './views/Entry';
import { OverviewView } from './views/Overview';
import { SettingsView } from './views/Settings';
import { TableView } from './views/Table';

const NAV: { view: Route['view']; label: string; icon: string }[] = [
  { view: 'overview', label: 'Áttekintés', icon: '⌂' },
  { view: 'entry', label: 'Rögzítés', icon: '✎' },
  { view: 'table', label: 'Táblázat', icon: '▦' },
  { view: 'charts', label: 'Grafikonok', icon: '▤' },
  { view: 'settings', label: 'Beállítások', icon: '⚙' },
];

function Shell() {
  const route = useRoute();
  const { loading, error, data, reload } = useApp();
  return (
    <div class="shell">
      <nav class="nav" aria-label="Fő navigáció">
        <span class="brand">Rezsi</span>
        {NAV.map((n) => (
          <a key={n.view} href={href({ view: n.view } as Route)} class={route.view === n.view ? 'active' : ''} aria-current={route.view === n.view ? 'page' : undefined}>
            <span class="nav-icon" aria-hidden="true">
              {n.icon}
            </span>
            <span class="nav-label">{n.label}</span>
          </a>
        ))}
      </nav>
      <main class="main">
        {error && (
          <div class="banner banner-bad" role="alert">
            Nem sikerült betölteni az adatokat: {error}{' '}
            <button type="button" class="link" onClick={() => void reload()}>
              Újra
            </button>
          </div>
        )}
        {data?.loadErrors?.map((e) => (
          <div key={e.file} class="banner banner-bad" role="alert">
            Hibás adatfájl ({e.file}), nem töltődött be: {e.error}
          </div>
        ))}
        {loading ? (
          <Spinner />
        ) : (
          <>
            {route.view === 'overview' && <OverviewView />}
            {route.view === 'entry' && <EntryView route={route} />}
            {route.view === 'table' && <TableView route={route} />}
            {route.view === 'charts' && <ChartsView route={route} />}
            {route.view === 'settings' && <SettingsView />}
          </>
        )}
      </main>
      <ToastHost />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
