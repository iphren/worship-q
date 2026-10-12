import { NewerDatabaseError } from '@worship-q/store';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { boot, type Booted } from './app/boot';
import { AppContext, useApp, useSession, type AppServices, type Page } from './app/context';
import { t, type MessageKey } from './i18n';
import { CalendarPage } from './pages/CalendarPage';
import { PresentPage } from './pages/PresentPage';
import { SettingsPage } from './pages/SettingsPage';
import { SongsPage } from './pages/SongsPage';

const PAGES: { page: Page; label: MessageKey; icon: ReactNode }[] = [
  {
    page: 'songs',
    label: 'nav.songs',
    icon: (
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
  },
  {
    page: 'calendar',
    label: 'nav.calendar',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
  },
  {
    page: 'present',
    label: 'nav.present',
    icon: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
  },
  {
    page: 'settings',
    label: 'nav.settings',
    icon: (
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
];

const LIVE_ICON = (
  <>
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
  </>
);

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
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-700 bg-slate-950/60 py-3">
      {PAGES.map((entry) => (
        <NavButton
          key={entry.page}
          target={entry.page}
          label={t(entry.label)}
          current={page === entry.page}
          className={`rounded-md p-2 ${
            page === entry.page ? 'bg-sky-700 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          {entry.icon}
        </NavButton>
      ))}
      <span className="flex-1" />
      {liveDate && (
        <NavButton
          target="present"
          label={t('nav.live')}
          className="rounded-md bg-emerald-700 p-2 hover:bg-emerald-600"
        >
          {LIVE_ICON}
        </NavButton>
      )}
    </nav>
  );
}

function NavButton(props: {
  target: Page;
  label: string;
  current?: boolean;
  className: string;
  children: ReactNode;
}) {
  const { navigate } = useApp();
  return (
    <button
      className={props.className}
      title={props.label}
      aria-label={props.label}
      aria-current={props.current ? 'page' : undefined}
      onClick={(event) => {
        // Leave the keyboard free for the presentation shortcuts.
        event.currentTarget.blur();
        navigate(props.target);
      }}
    >
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {props.children}
      </svg>
    </button>
  );
}
