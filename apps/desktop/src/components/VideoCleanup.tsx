/**
 * Old video copies only this computer has (U30): one banner saying how much space they use,
 * with **Review…** and **Dismiss**, and a window listing them with a checklist. Each shows its
 * copy's path in the app's folder, never the file it was added from, so nobody thinks their
 * own files are being deleted, and **Open** plays the copy to see what it is.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from '../app/context';
import type { CleanupOffer, CleanupResult } from '../app/videoCache';
import { t } from '@worship-q/i18n/desktop';
import { native } from '../platform/native';
import { Dialog } from './Dialog';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** A size as people read it: in GB from 1 GB, else in MB. */
export function diskSize(bytes: number): string {
  return bytes >= GB
    ? t('cleanup.gb', { size: (bytes / GB).toFixed(1) })
    : t('cleanup.mb', { size: String(Math.max(1, Math.round(bytes / MB))) });
}

/** How long the freed notice stays. */
const NOTICE_MS = 8000;

export function VideoCleanupBanner() {
  const { cloud } = useApp();
  const offer = useSyncExternalStore(cloud.videos.subscribe, () => cloud.videos.offer);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (notice) {
    return (
      <div
        className="flex items-center gap-3 border-b border-emerald-700 bg-emerald-950 px-4 py-2 text-sm text-emerald-100"
        role="status"
      >
        <span className="flex-1">{notice}</span>
        <button
          className="btn btn-ghost btn-sm"
          title={t('common.close')}
          onClick={() => setNotice(null)}
        >
          ✕
        </button>
      </div>
    );
  }
  if (!offer) return null;
  return (
    <>
      <div className="flex items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200">
        <span className="flex-1">{t('cleanup.banner', { size: diskSize(offer.totalBytes) })}</span>
        <button className="btn btn-sm" onClick={() => setReviewing(true)}>
          {t('cleanup.review')}…
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => cloud.videos.dismissOffer()}>
          {t('cleanup.dismiss')}
        </button>
      </div>
      {reviewing && (
        <VideoCleanupWindow
          offer={offer}
          onClose={() => setReviewing(false)}
          onRemoved={(result) => {
            setReviewing(false);
            setNotice(freedText(result));
          }}
        />
      )}
    </>
  );
}

/** What the notice says once the chosen copies are removed. */
export function freedText(result: CleanupResult): string {
  const parts = [t('cleanup.freed', { size: diskSize(result.freedBytes) })];
  if (result.failed > 0) parts.push(t('cleanup.failed', { count: result.failed }));
  if (result.needed > 0) parts.push(t('cleanup.needed', { count: result.needed }));
  return parts.join(' ');
}

function VideoCleanupWindow(props: {
  offer: CleanupOffer;
  onClose(): void;
  onRemoved(result: CleanupResult): void;
}) {
  const { cloud } = useApp();
  const { videos } = props.offer;
  const [chosen, setChosen] = useState(() => new Set(videos.map((video) => video.file)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = videos
    .filter((video) => chosen.has(video.file))
    .reduce((sum, video) => sum + video.bytes, 0);

  const toggle = (file: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  async function remove() {
    setBusy(true);
    try {
      props.onRemoved(await cloud.videos.removeSelected([...chosen]));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      wide
      title={t('cleanup.title')}
      onClose={props.onClose}
      actions={
        <>
          <span className="flex-1 text-sm text-slate-400">
            {t('cleanup.total', { size: diskSize(total) })}
          </span>
          <button className="btn" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-danger"
            disabled={chosen.size === 0 || busy}
            onClick={() => void remove()}
          >
            {t('cleanup.remove')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-300">{t('cleanup.intro')}</p>
        <div className="flex gap-2">
          <button
            className="btn btn-sm"
            onClick={() => setChosen(new Set(videos.map((video) => video.file)))}
          >
            {t('cleanup.selectAll')}
          </button>
          <button className="btn btn-sm" onClick={() => setChosen(new Set())}>
            {t('cleanup.selectNone')}
          </button>
        </div>
        <ul className="max-h-[50vh] divide-y divide-slate-800 overflow-y-auto">
          {videos.map((video) => (
            <li key={video.file} className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0"
                checked={chosen.has(video.file)}
                aria-label={video.title}
                onChange={() => toggle(video.file)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{video.title}</span>
                <span className="block truncate text-xs text-slate-500" title={video.path}>
                  {video.path}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-400 tabular-nums">
                {diskSize(video.bytes)}
              </span>
              <button
                className="btn btn-sm shrink-0"
                onClick={() => {
                  setError(null);
                  native.openVideo(video.file).catch(() => setError(t('cleanup.openFailed')));
                }}
              >
                {t('cleanup.open')}
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="text-xs text-rose-300">{error}</p>}
      </div>
    </Dialog>
  );
}
