/**
 * The admin web app (phase 3, decision D35): sign-in through the church's provider, then
 * the pages an administrator uses instead of the command line.
 */
import type { AdminMe } from '@worship-q/protocol';
import { useEffect, useState, type ReactNode } from 'react';
import { api, describeError, onSignedOut } from './api';
import { errorText, routePath, type Route } from './format';
import { AdministratorsPage } from './pages/Administrators';
import { McpUsersPage } from './pages/McpUsers';
import { DevicesPage } from './pages/Devices';
import { LibraryPage } from './pages/Library';
import { SettingsPage } from './pages/Settings';
import { StoragePage } from './pages/Storage';
import { WorkspacePage } from './pages/Workspace';
import { WorkspacesPage } from './pages/Workspaces';
import { navigate, useRoute } from './router';
import { SessionContext } from './session';
import { Button, ErrorText, Link, Spinner } from './ui';
import { useAction } from './useLoad';
import {
  languageChoices,
  loadBrowserPreference,
  saveBrowserPreference,
  t,
  type MessageKey,
} from '@worship-q/i18n/admin';

export function AdminApp() {
  const route = useRoute();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.me().then(
      (next) => {
        setMe(next);
        setError(null);
      },
      (cause: unknown) => setError(describeError(cause)),
    );
  useEffect(() => {
    void load();
    // A 401 from any page means the session ended: back to the sign-in page, keeping the
    // address so the person returns to it after signing in.
    return onSignedOut(() => setMe((m) => (m ? { ...m, admin: null } : m)));
  }, []);

  if (!me) {
    return (
      <Centered>
        {error ? (
          <>
            <ErrorText error={error} />
            <Button variant="primary" onClick={() => void load()}>
              {t('common.tryAgain')}
            </Button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-slate-400">
            <Spinner /> {t('common.loading')}
          </p>
        )}
      </Centered>
    );
  }

  if (!me.admin) return <SignIn me={me} route={route} />;
  return (
    <SessionContext.Provider value={me}>
      <Shell me={me} route={route} onSignedOut={() => setMe({ ...me, admin: null })}>
        <Page route={route} />
      </Shell>
    </SessionContext.Provider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      {children}
    </main>
  );
}

// ── Sign-in (D27, D28) ───────────────────────────────────────────────────────

function SignIn({ me, route }: { me: AdminMe; route: Route }) {
  // After signing in the person comes back to the page they asked for, such as the
  // pairing deep link; the sign-in page itself leads to Workspaces.
  const returnTo =
    route.page === 'home' || route.page === 'not-found'
      ? routePath({ page: 'workspaces' })
      : routePath(route);
  const code = route.page === 'home' ? route.error : null;
  return (
    <Centered>
      <img src={logoUrl} alt="" className="h-14 w-14" />
      <h1 className="text-2xl font-semibold text-white">{me.name}</h1>
      <p className="text-sm text-slate-400">{t('signIn.subtitle')}</p>
      {code && (
        <p
          role="alert"
          className="max-w-md rounded-lg bg-red-950/70 px-4 py-3 text-sm text-red-200"
        >
          {errorText(code)}
        </p>
      )}
      {me.configured ? (
        <Button
          variant="primary"
          onClick={() =>
            window.location.assign(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`)
          }
        >
          {t('signIn.button')}
        </Button>
      ) : (
        <div className="max-w-md space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-left text-sm text-slate-300">
          <h2 className="font-semibold text-white">{t('signIn.notSetUpTitle')}</h2>
          <p>{t('signIn.notSetUp')}</p>
          <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-slate-200">
            <li>WORSHIP_Q_OIDC_ISSUER</li>
            <li>WORSHIP_Q_OIDC_CLIENT_ID</li>
            <li>WORSHIP_Q_PUBLIC_URL</li>
          </ul>
          <p>{t('signIn.untilThen')}</p>
        </div>
      )}
    </Centered>
  );
}

const logoUrl = new URL('./assets/logo.svg', import.meta.url).href;

// ── The pages ───────────────────────────────────────────────────────────────

const NAV: { route: Route; label: MessageKey }[] = [
  { route: { page: 'workspaces' }, label: 'nav.workspaces' },
  { route: { page: 'devices', pairCode: null }, label: 'nav.devices' },
  { route: { page: 'library' }, label: 'nav.library' },
  { route: { page: 'administrators' }, label: 'nav.administrators' },
  { route: { page: 'mcp-users' }, label: 'nav.mcpUsers' },
  { route: { page: 'settings' }, label: 'nav.settings' },
  { route: { page: 'storage' }, label: 'nav.storage' },
];

const section = (route: Route): Route['page'] =>
  route.page === 'workspace' ? 'workspaces' : route.page;

function Shell(props: { me: AdminMe; route: Route; onSignedOut(): void; children: ReactNode }) {
  const { me, route } = props;
  const signOut = useAction();
  const current = section(route);
  const who = me.admin?.name ?? me.admin?.email ?? '';
  const nav = NAV.map(({ route: target, label }) => (
    <Link
      key={target.page}
      to={routePath(target)}
      className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap ${
        current === target.page
          ? 'bg-slate-800 text-white'
          : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
      }`}
    >
      {t(label)}
    </Link>
  ));
  const account = (
    <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
      <span className="min-w-0 truncate" title={me.admin?.email}>
        {who}
      </span>
      <Button small variant="ghost" busy={signOut.busy} onClick={() => void doSignOut()}>
        {t('signOut')}
      </Button>
    </div>
  );
  const languageSelect = (
    <select
      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
      aria-label={t('language.label')}
      value={loadBrowserPreference()}
      onChange={(event) =>
        saveBrowserPreference(event.target.value as ReturnType<typeof loadBrowserPreference>)
      }
    >
      {languageChoices().map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );

  async function doSignOut() {
    // The logout answers with no body, so success is said here: `run` gives undefined on failure.
    const done = await signOut.run(async () => {
      await api.logout();
      return true;
    });
    if (done) {
      props.onSignedOut();
      navigate({ page: 'home', error: null }, true);
    }
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* The sidebar on wide screens... */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-4 lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="mb-6 flex items-center gap-3">
          <img src={logoUrl} alt="" className="h-9 w-9" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">{me.name}</p>
            <p className="text-xs text-slate-500">{t('nav.subtitle')}</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">{nav}</nav>
        <div className="mt-auto space-y-2 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
            {t('language.label')}
            {languageSelect}
          </div>
          {account}
          <ErrorText error={signOut.error} />
        </div>
      </aside>
      {/* ...and a header with a scrolling row of pages on phones. */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3 px-4 pt-3">
          <img src={logoUrl} alt="" className="h-8 w-8" />
          <p className="min-w-0 flex-1 truncate font-semibold text-white">{me.name}</p>
          <div className="shrink-0">{languageSelect}</div>
          <div className="shrink-0">{account}</div>
        </div>
        <ErrorText error={signOut.error} className="px-4 pt-1" />
        <nav className="flex gap-1 overflow-x-auto px-3 py-2">{nav}</nav>
      </header>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">{props.children}</div>
      </main>
    </div>
  );
}

function Page({ route }: { route: Route }) {
  // The sign-in address leads to Workspaces once signed in.
  useEffect(() => {
    if (route.page === 'home') navigate({ page: 'workspaces' }, true);
  }, [route]);
  switch (route.page) {
    case 'home':
      return null;
    case 'workspaces':
      return <WorkspacesPage />;
    case 'workspace':
      return <WorkspacePage id={route.id} />;
    case 'devices':
      return <DevicesPage pairCode={route.pairCode} />;
    case 'library':
      return <LibraryPage />;
    case 'administrators':
      return <AdministratorsPage />;
    case 'mcp-users':
      return <McpUsersPage />;
    case 'settings':
      return <SettingsPage />;
    case 'storage':
      return <StoragePage />;
    case 'not-found':
      return (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold text-white">{t('notFound.title')}</h1>
          <p className="text-slate-400">{t('notFound.text')}</p>
          <Link to={routePath({ page: 'workspaces' })} className="text-sky-400 hover:underline">
            {t('notFound.link')}
          </Link>
        </div>
      );
  }
}
