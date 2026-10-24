import { useCallback, useEffect, useState } from 'react';
import { useCloud, useSession } from '../app/context';
import { t } from '../i18n';
import { native, type WorkspaceEntry } from '../platform/native';
import { ConfirmDialog, Dialog } from './Dialog';
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
  const output = useOutputStatus();
  const { workspaces, reload } = useWorkspaces();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Waits for confirmation because the slideshow is showing. */
  const [leaving, setLeaving] = useState<(() => Promise<void>) | null>(null);
  const [removing, setRemoving] = useState<WorkspaceEntry | null>(null);
  const showing = output.windowed || output.decision.kind === 'open';

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
            </div>
            {entry.active ? (
              <span className="text-xs text-emerald-300">{t('workspaces.current')}</span>
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

/** Sidebar button showing the open workspace, once this computer keeps more than one. */
export function WorkspaceButton() {
  const name = useWorkspaceName();
  const { workspaces } = useWorkspaces();
  const [open, setOpen] = useState(false);
  if (!workspaces || workspaces.length < 2) return null;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]!.toUpperCase())
    .join('');
  return (
    <>
      <button
        className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-600 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        title={`${name} · ${t('workspaces.choose')}`}
        aria-label={`${name} · ${t('workspaces.choose')}`}
        onClick={(event) => {
          // Leave the keyboard free for the presentation shortcuts.
          event.currentTarget.blur();
          setOpen(true);
        }}
      >
        {initials}
      </button>
      {open && (
        <Dialog title={t('workspaces.title')} onClose={() => setOpen(false)}>
          <WorkspaceList />
        </Dialog>
      )}
    </>
  );
}
