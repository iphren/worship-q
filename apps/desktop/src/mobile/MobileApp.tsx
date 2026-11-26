import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { ask } from '@tauri-apps/plugin-dialog';
import { t } from '@worship-q/i18n/desktop';
import { readScanned } from '@worship-q/protocol';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { native } from '../platform/native';
import { listStore } from './listStore';
import { grantAccount, lastOpened, openInvitation, remove, type RemoteEntry } from './remoteList';
import { RemoteWorkspace } from './RemoteWorkspace';
import { cancelScan, openCameraSettings, scanQrCode } from './scanner';

type Notice = 'not-invitation' | 'no-camera' | null;

/**
 * Opens what a link or a scan gave (N13): an invitation adds or opens its workspace; anything
 * else is not one. Returns the entry to show, or null.
 */
function openText(text: string): RemoteEntry | null {
  const scanned = readScanned(text);
  if (!scanned) return null;
  const { list, entry } = openInvitation(listStore.list, scanned, () => crypto.randomUUID());
  listStore.set(list);
  return entry;
}

/** Marks an entry as opened now, so the app reopens it next time. */
function opened(entry: RemoteEntry): void {
  listStore.update(entry.id, (e) => ({ ...e, lastOpenedAt: new Date().toISOString() }));
}

/**
 * The phone and tablet app's home: the device's workspaces (native apps plan, "The workspace
 * list"; M2.10). It reopens the workspace last used, and invitation links and scans add or
 * open theirs. The page draws under the status bar and home indicator and pads by them.
 */
export function MobileApp() {
  const list = useSyncExternalStore(listStore.subscribe, () => listStore.list);
  const loaded = useSyncExternalStore(listStore.subscribe, () => listStore.loaded);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const show = (entry: RemoteEntry | null) => {
    if (!entry) return setNotice('not-invitation');
    setNotice(null);
    opened(entry);
    setOpenId(entry.id);
  };

  useEffect(() => {
    let active = true;
    let stopLinks: (() => void) | null = null;
    void (async () => {
      await listStore.load();
      // An invitation link that opened the app wins over the workspace used last.
      const launched = await getCurrent().catch(() => null);
      if (!active) return;
      const fromLink = launched?.[0] ? openText(launched[0]) : null;
      const entry = fromLink ?? lastOpened(listStore.list);
      if (entry) {
        opened(entry);
        setOpenId(entry.id);
      }
      stopLinks = await onOpenUrl((urls) => urls[0] && show(openText(urls[0])));
    })();
    return () => {
      active = false;
      stopLinks?.();
    };
  }, []);

  const entry = list.entries.find((candidate) => candidate.id === openId) ?? null;
  if (entry) {
    return <RemoteWorkspace key={entry.id} entry={entry} onBack={() => setOpenId(null)} />;
  }

  const startScan = async () => {
    setNotice(null);
    setScanning(true);
    const result = await scanQrCode();
    setScanning(false);
    if (result.kind === 'scanned') show(openText(result.text));
    else if (result.kind === 'no-camera') setNotice('no-camera');
  };

  if (scanning) {
    return (
      <div className="flex h-dvh flex-col items-center justify-between bg-transparent px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-white">
        <p className="rounded-lg bg-black/60 px-4 py-2 text-center">{t('mobile.scanHint')}</p>
        <div className="aspect-square w-3/4 max-w-xs rounded-3xl border-4 border-white/80" />
        <button
          className="min-h-12 w-full max-w-xs rounded-xl bg-black/70 text-base font-semibold"
          onClick={() => void cancelScan()}
        >
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  const removeEntry = async (target: RemoteEntry) => {
    const sure = await ask(t('mobile.removeConfirm', { name: target.name }), {
      kind: 'warning',
      okLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
    });
    if (!sure) return;
    listStore.set(remove(listStore.list, target.id));
    await native.keychainDelete(grantAccount(target)).catch(console.error);
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-950 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-slate-100">
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-2xl font-semibold">{t('mobile.workspaces')}</h1>
        {list.entries.length > 0 && (
          <button className="min-h-11 px-2 text-sky-300" onClick={() => setEditing((now) => !now)}>
            {t(editing ? 'mobile.done' : 'mobile.edit')}
          </button>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4">
        {notice && (
          <div className="mb-3 rounded-lg border border-amber-700 bg-amber-950 p-3 text-sm text-amber-100">
            <p>{t(notice === 'no-camera' ? 'mobile.noCamera' : 'mobile.notInvitation')}</p>
            {notice === 'no-camera' && (
              <button className="mt-2 min-h-11 text-sky-300" onClick={openCameraSettings}>
                {t('mobile.openSettings')}
              </button>
            )}
          </div>
        )}
        {loaded && list.entries.length === 0 ? (
          <p className="mt-16 px-2 text-center text-slate-300">{t('mobile.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900">
            {list.entries.map((item) => (
              <li key={item.id} className="flex items-center">
                <button
                  className="flex min-h-16 min-w-0 flex-1 flex-col items-start justify-center px-4 py-2 text-left disabled:opacity-100"
                  disabled={editing}
                  onClick={() => show(item)}
                >
                  <span className="w-full truncate text-base">{item.name || '—'}</span>
                  <span className="flex w-full items-center gap-2 text-sm text-slate-400">
                    <span className="truncate">
                      {item.serverUrl ? new URL(item.serverUrl).host : t('mobile.venueOnly')}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{t('mobile.remoteControl')}</span>
                    {item.presenting && (
                      <span className="flex shrink-0 items-center gap-1 text-emerald-300">
                        <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-400" />
                        {t('mobile.presenting')}
                      </span>
                    )}
                  </span>
                </button>
                {editing && (
                  <button
                    className="mr-2 min-h-11 rounded-lg px-3 text-red-300"
                    onClick={() => void removeEntry(item)}
                  >
                    {t('common.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="p-4">
        <button
          className="btn btn-primary min-h-12 w-full text-base"
          onClick={() => void startScan()}
        >
          {t('mobile.scan')}
        </button>
      </footer>
    </div>
  );
}
