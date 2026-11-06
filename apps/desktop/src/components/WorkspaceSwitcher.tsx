import { useCallback, useEffect, useState } from 'react';
import { useApp, useCloud, useSession } from '../app/context';
import { t } from '../i18n';
import { native, type WorkspaceEntry } from '../platform/native';
import { ChurchConnection, useChurchProblem } from './ChurchConnection';
import { ConfirmDialog, Dialog } from './Dialog';
import { Icon } from './Icon';
import { useOutputStatus } from './OutputPanel';

/** The workspaces kept on this computer; null until read. */
export function useWorkspaces(): { workspaces: WorkspaceEntry[] | null; reload(): void } {
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[] | null>(null);
  const reload = useCallback(() => {
    native.listWorkspaces().then(setWorkspaces, (error) => console.error(error));
  }, []);
  useEffect(reload, [reload]);
  return { workspaces, reload };
}

/** The current workspace's name: the church's name for it once joined, else its own. */
export function useWorkspaceName(): string {
  const session = useSession();
  const { state } = useCloud();
  const churchName = state?.joinedAt ? state.workspaceName : null;
  return churchName || session.workspace.name || t('workspaces.unnamed');
}

/** Settings section: the workspaces on this computer, to switch between, add or remove. */
export function WorkspaceList() {
  const currentName = useWorkspaceName();
  const problem = useChurchProblem();
  const { cloud } = useApp();
  const output = useOutputStatus();
  const { workspaces, reload } = useWorkspaces();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Waits for confirmation because the slideshow is showing. */
  const [leaving, setLeaving] = useState<(() => Promise<void>) | null>(null);
  const [removing, setRemoving] = useState<WorkspaceEntry | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const status = useCloud();
  const joined = Boolean(status.state?.joinedAt);
  const showing = output.windowed || output.decision.kind === 'open';
  const [retrying, setRetrying] = useState(false);
  // A failed sync or backup can be tried again from here, without a trip to Settings.
  const retry = !problem
    ? null
    : status.sync.kind === 'error'
      ? { label: t('church.syncNow'), run: () => cloud.sync() }
      : status.backup.kind === 'failed'
        ? { label: t('church.backupNow'), run: () => cloud.backupNow() }
        : null;

  const nameOf = (entry: WorkspaceEntry) =>
    entry.active ? currentName : entry.name || t('workspaces.unnamed');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(t('workspaces.failed', { error: String(error) }));
    } finally {
      setBusy(false);
    }
  }

  // The app reopens on success, so nothing more happens here.
  function reopen(action: () => Promise<void>) {
    if (showing) setLeaving(() => action);
    else void run(action);
  }

  async function remove(entry: WorkspaceEntry) {
    setRemoving(null);
    await run(async () => {
      const path = await native.removeWorkspace(entry.id);
      reload();
      setMessage(t('workspaces.removed', { path }));
    });
  }

  if (!workspaces) return null;
  return (
    <div className="space-y-2 text-sm">
      <ul className="divide-y divide-slate-700 rounded-md border border-slate-700">
        {workspaces.map((entry) => (
          <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{nameOf(entry)}</p>
              <p className="truncate text-xs text-slate-400">
                {entry.server ? entry.server.replace(/^https?:\/\//, '') : t('workspaces.local')}
              </p>
              {entry.active && problem && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-300">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                  <span className="min-w-0 break-words">{problem}</span>
                </p>
              )}
            </div>
            {entry.active ? (
              <>
                {!joined && (
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => setConnecting(true)}
                  >
                    {t('workspaces.connect')}
                  </button>
                )}
                {retry && (
                  <button
                    className="btn btn-sm px-2"
                    disabled={busy || retrying}
                    title={retry.label}
                    aria-label={retry.label}
                    onClick={() => {
                      setRetrying(true);
                      void retry.run().finally(() => setRetrying(false));
                    }}
                  >
                    <Icon name="sync" className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
                  </button>
                )}
                {problem && (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => setDisconnecting(true)}
                  >
                    {t('church.disconnect')}
                  </button>
                )}
                <span className="text-xs text-emerald-300">{t('workspaces.current')}</span>
              </>
            ) : (
              <>
                {entry.id !== 'default' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => setRemoving(entry)}
                  >
                    {t('workspaces.remove')}
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => reopen(() => native.switchWorkspace(entry.id))}
                >
                  {t('workspaces.switch')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <button className="btn" disabled={busy} onClick={() => reopen(() => native.addWorkspace())}>
        {t('workspaces.add')}
      </button>
      {message && <p className="text-xs text-slate-300">{message}</p>}

      {leaving && (
        <ConfirmDialog
          title={t('workspaces.leaveLiveTitle')}
          body={t('workspaces.leaveLiveBody')}
          confirmLabel={t('workspaces.leaveLiveConfirm')}
          onCancel={() => setLeaving(null)}
          onConfirm={() => {
            const action = leaving;
            setLeaving(null);
            void run(action);
          }}
        />
      )}
      {connecting && (
        <Dialog title={t('church.title')} onClose={() => setConnecting(false)}>
          <p className="mb-3 text-xs text-slate-400">{t('church.hint')}</p>
          <ChurchConnection />
        </Dialog>
      )}
      {disconnecting && (
        <ConfirmDialog
          title={t('church.disconnectTitle')}
          body={t('church.disconnectBody')}
          confirmLabel={t('church.disconnect').replace('…', '')}
          danger
          onCancel={() => setDisconnecting(false)}
          onConfirm={() => {
            setDisconnecting(false);
            // The app reloads once disconnected.
            void run(() => cloud.disconnect());
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t('workspaces.removeTitle', { name: nameOf(removing) })}
          body={t('workspaces.removeBody')}
          confirmLabel={t('workspaces.remove').replace('…', '')}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      )}
    </div>
  );
}

/**
 * Sidebar button showing the open workspace, once this computer keeps more than one or is
 * connected to a church.
 */
export function WorkspaceButton() {
  const name = useWorkspaceName();
  const problem = useChurchProblem();
  const { workspaces } = useWorkspaces();
  const joined = Boolean(useCloud().state?.joinedAt);
  const [open, setOpen] = useState(false);
  // Shown once there is a choice to make, or a church connection to keep an eye on.
  if (!workspaces || (workspaces.length < 2 && !joined)) return null;
  const label = [name, joined ? problem : t('workspaces.local'), t('workspaces.choose')]
    .filter(Boolean)
    .join(' · ');
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]!.toUpperCase())
    .join('');
  return (
    <>
      <button
        className="flex h-11 w-11 items-center justify-center rounded-md text-slate-200 hover:bg-slate-800"
        title={label}
        aria-label={label}
        onClick={(event) => {
          // Leave the keyboard free for the presentation shortcuts.
          event.currentTarget.blur();
          setOpen(true);
        }}
      >
        {joined ? (
          <span
            className={`relative flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-semibold ${
              problem ? 'border-amber-400' : 'border-slate-500'
            }`}
          >
            {initials}
            {problem && (
              <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-amber-400" />
            )}
          </span>
        ) : (
          // A workspace kept only on this computer has no church to show initials for.
          <Icon name="offline" className="h-5 w-5 text-slate-400" />
        )}
      </button>
      {open && (
        <Dialog title={t('workspaces.title')} onClose={() => setOpen(false)}>
          <WorkspaceList />
        </Dialog>
      )}
    </>
  );
}
