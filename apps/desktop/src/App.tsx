import { NewerDatabaseError } from '@worship-q/store';
import { useEffect, useMemo, useState } from 'react';
import { boot, type Booted } from './app/boot';
import { AppContext, useApp, useSession, type AppServices, type Page } from './app/context';
import { t, type MessageKey } from './i18n';
import { CalendarPage } from './pages/CalendarPage';
import { PresentPage } from './pages/PresentPage';
import { SettingsPage } from './pages/SettingsPage';
import { SongsPage } from './pages/SongsPage';

const PAGES: { page: Page; label: MessageKey }[] = [
  { page: 'songs', label: 'nav.songs' },
  { page: 'calendar', label: 'nav.calendar' },
  { page: 'present', label: 'nav.present' },
  { page: 'settings', label: 'nav.settings' },
];

// Started once per window, also when React mounts the app twice in development.
let booting: Promise<Booted> | undefined;

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; booted: Booted }
  | { status: 'failed'; message: string };

export function App() {
  const [state, setState] = useState<BootState>({ status: 'loading' });
  useEffect(() => {
    booting ??= boot();
    booting.then(
      (booted) => setState({ status: 'ready', booted }),
      (error) => {
        console.error(error);
        const newer = error instanceof NewerDatabaseError;
        setState({
          status: 'failed',
          message: newer ? t('app.newerData') : `${t('app.failed')} ${String(error)}`,
        });
      },
    );
  }, []);

  if (state.status === 'loading') return <Centered>{t('app.loading')}</Centered>;
  if (state.status === 'failed') return <Centered>{state.message}</Centered>;
  return <Shell booted={state.booted} />;
}

function Centered(props: { children: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-slate-400">
      {props.children}
    </div>
  );
}

function Shell({ booted }: { booted: Booted }) {
  // Resuming or starting a live state goes straight to presenting; otherwise to planning.
  const [page, setPage] = useState<Page>(
    booted.start === 'resumed' || booted.start === 'started' ? 'present' : 'calendar',
  );
  const services = useMemo<AppServices>(
    () => ({ session: booted.session, output: booted.output, navigate: setPage }),
    [booted],
  );

  return (
    <AppContext.Provider value={services}>
      <div className="flex h-full">
        <Sidebar page={page} />
        <div className="min-w-0 flex-1">
          {page === 'songs' && <SongsPage />}
          {page === 'calendar' && <CalendarPage />}
          {page === 'present' && <PresentPage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </div>
    </AppContext.Provider>
  );
}

function Sidebar({ page }: { page: Page }) {
  const { liveDate } = useSession();
  return (
    <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-slate-700 bg-slate-950/60 p-3">
      <div className="mb-3 px-2 text-lg font-bold tracking-tight">{t('app.name')}</div>
      {PAGES.map((entry) => (
        <NavButton
          key={entry.page}
          target={entry.page}
          className={`rounded-md px-3 py-2 text-left text-sm font-medium ${
            page === entry.page ? 'bg-sky-700 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          {t(entry.label)}
        </NavButton>
      ))}
      <span className="flex-1" />
      {liveDate && (
        <NavButton
          target="present"
          className="rounded-md bg-rose-700 px-2 py-1.5 text-center text-xs font-semibold hover:bg-rose-600"
        >
          {t('nav.live')}
        </NavButton>
      )}
    </nav>
  );
}

function NavButton(props: { target: Page; className: string; children: string }) {
  const { navigate } = useApp();
  return (
    <button
      className={props.className}
      onClick={(event) => {
        // Leave the keyboard free for the presentation shortcuts.
        event.currentTarget.blur();
        navigate(props.target);
      }}
    >
      {props.children}
    </button>
  );
}
