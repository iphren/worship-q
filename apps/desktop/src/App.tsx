import { NewerDatabaseError } from '@worship-q/store';
import { useEffect, useMemo, useState } from 'react';
import { boot, type Booted } from './app/boot';
import {
  AppContext,
  useApp,
  useCloud,
  useRemoteHost,
  useSession,
  type AppServices,
  type Page,
} from './app/context';
import { Icon, type IconName } from './components/Icon';
import { RemoteControlDialog, RemoteRequestsBanner } from './components/RemoteControl';
import { WorkspaceButton } from './components/WorkspaceSwitcher';
import { t, type MessageKey } from './i18n';
import { CalendarPage } from './pages/CalendarPage';
import { PresentPage } from './pages/PresentPage';
import { SettingsPage } from './pages/SettingsPage';
import { SongsPage } from './pages/SongsPage';

const PAGES: { page: Page; label: MessageKey; icon: IconName }[] = [
  { page: 'songs', label: 'nav.songs', icon: 'songs' },
  { page: 'calendar', label: 'nav.calendar', icon: 'calendar' },
  { page: 'present', label: 'nav.present', icon: 'screen' },
  { page: 'settings', label: 'nav.settings', icon: 'settings' },
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
  // Something is always live once the app has opened, so it opens on presenting.
  const [page, setPage] = useState<Page>('present');
  const services = useMemo<AppServices>(
    () => ({
      session: booted.session,
      output: booted.output,
      cloud: booted.cloud,
      navigate: setPage,
    }),
    [booted],
  );

  return (
    <AppContext.Provider value={services}>
      <div className="flex h-full">
        <Sidebar page={page} />
        <div className="flex min-w-0 flex-1 flex-col">
          <RemoteRequestsBanner />
          <div className="min-h-0 flex-1">
            {page === 'songs' && <SongsPage />}
            {page === 'calendar' && <CalendarPage />}
            {page === 'present' && <PresentPage />}
            {page === 'settings' && <SettingsPage />}
          </div>
        </div>
      </div>
    </AppContext.Provider>
  );
}

function Sidebar({ page }: { page: Page }) {
  const { liveDate } = useSession();
  const cloud = useCloud();
  const host = useRemoteHost();
  const [remoteOpen, setRemoteOpen] = useState(false);
  const remoteActive = cloud.relay.kind === 'coordinator' && host.connected.length > 0;
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
          <Icon name={entry.icon} />
        </NavButton>
      ))}
      <span className="flex-1" />
      <WorkspaceButton />
      <button
        className={`relative rounded-md p-2 ${
          remoteActive ? 'text-sky-300 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-800'
        }`}
        title={t('remote.title')}
        aria-label={t('remote.title')}
        onClick={(event) => {
          event.currentTarget.blur();
          setRemoteOpen(true);
        }}
      >
        <Icon name="phone" />
        {host.connected.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 rounded-full bg-sky-600 px-1 text-[10px] leading-4 font-semibold text-white">
            {host.connected.length}
          </span>
        )}
      </button>
      {remoteOpen && <RemoteControlDialog onClose={() => setRemoteOpen(false)} />}
      {liveDate && (
        <NavButton
          target="present"
          label={t('nav.live')}
          className="rounded-md bg-emerald-700 p-2 hover:bg-emerald-600"
        >
          <Icon name="live" />
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
  children: React.ReactNode;
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
      {props.children}
    </button>
  );
}
