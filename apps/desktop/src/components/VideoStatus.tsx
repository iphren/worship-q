import type { Video } from '@worship-q/protocol';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp, useQuery, useSession } from '../app/context';
import type { CopyStatus } from '../app/videoCache';
import { t } from '../i18n';
import { native } from '../platform/native';
import { videoPosition } from '@worship-q/live-state';
import { formatDuration } from '@worship-q/session';

/** A video's copy on this computer, re-rendering the caller when it changes (U8). */
export function useVideoCopy(file: string): CopyStatus | undefined {
  const { cloud } = useApp();
  return useSyncExternalStore(cloud.videos.subscribe, () => cloud.videos.status(file));
}

/** Whether this computer has a copy of a video, asked again whenever the cache changes. */
export function useHasCopy(file: string): boolean | undefined {
  const status = useVideoCopy(file);
  return useQuery(
    () =>
      native
        .videoLocation(file)
        .then((where) => where.exists)
        .catch(() => false),
    [file, status?.kind],
  );
}

/**
 * A video item's download, on its run sheet row (U8): a bar until its copy is ready, then
 * nothing; a failure says why, with Try again.
 */
export function VideoCopyState(props: { file: string }) {
  const { cloud } = useApp();
  const status = useVideoCopy(props.file);
  if (!status || status.kind === 'ready') return null;
  if (status.kind === 'failed') {
    return (
      <span className="mt-1 flex items-center gap-2 text-xs text-rose-300">
        <span className="min-w-0 flex-1 truncate" title={status.message}>
          {t('video.fetchFailed', { message: status.message })}
        </span>
        <button
          type="button"
          className="btn px-2 py-0.5 text-xs"
          onClick={() => void cloud.videos.pass()}
        >
          {t('media.tryAgain')}
        </button>
      </span>
    );
  }
  const percent =
    status.kind === 'downloading' && status.total > 0
      ? Math.floor((status.done / status.total) * 100)
      : 0;
  const label =
    status.kind === 'waiting' ? t('video.waiting') : t('video.downloading', { percent });
  return (
    <span className="mt-1 block" title={label}>
      <span
        className="block h-1 overflow-hidden rounded-full bg-slate-700"
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
      >
        <span
          className="block h-full rounded-full bg-violet-400 transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  );
}

/** A video item's tile among the Live page's slides: its length and its copy's state. */
export function VideoTile(props: { video: Video }) {
  const has = useHasCopy(props.video.file);
  return (
    <span className="flex flex-col items-center justify-center gap-1 py-1">
      <span className="text-2xl leading-none text-violet-300" aria-hidden>
        ▶
      </span>
      <span className="text-xs text-slate-300">{formatDuration(props.video.durationSeconds)}</span>
      {has === false && <span className="text-[11px] text-amber-300">{t('video.notReady')}</span>}
      <span className="w-full px-1">
        <VideoCopyState file={props.video.file} />
      </span>
    </span>
  );
}

/** Re-renders every quarter second while `on`, for a moving position. */
function useTicking(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}

/**
 * The control bar while a video item is live (M6.4): play or pause, the position and length,
 * a scrubber, and jumps of 10 seconds. Says so when this computer has no copy to play.
 */
export function VideoControls(props: { file: string | null }) {
  const session = useSession();
  const video = session.video;
  const now = useTicking(!!video?.playing);
  const has = useHasCopy(props.file ?? '');
  const [dragging, setDragging] = useState<number | null>(null);
  if (!video) return null;
  const position = dragging ?? videoPosition(video, new Date(now).toISOString());
  const duration = video.durationSeconds;
  return (
    <div
      className="panel flex flex-wrap items-center gap-2 px-3 py-2"
      role="group"
      aria-label={t('video.controls')}
    >
      <button
        type="button"
        className="btn px-2"
        title={`${t('video.back')} (←)`}
        aria-label={t('video.back')}
        onClick={() => void session.videoSeek({ by: -10 })}
      >
        −10s
      </button>
      <button
        type="button"
        className="btn btn-primary min-w-20"
        title={`${video.playing ? t('video.pause') : t('video.play')} (Space)`}
        onClick={() => void session.videoPlay(!video.playing)}
      >
        {video.playing ? `❚❚ ${t('video.pause')}` : `▶ ${t('video.play')}`}
      </button>
      <button
        type="button"
        className="btn px-2"
        title={`${t('video.forward')} (→)`}
        aria-label={t('video.forward')}
        onClick={() => void session.videoSeek({ by: 10 })}
      >
        +10s
      </button>
      <span className="w-24 shrink-0 text-center text-xs text-slate-300 tabular-nums">
        {formatDuration(position)} / {formatDuration(duration)}
      </span>
      <input
        type="range"
        className="min-w-32 flex-1 accent-violet-400"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(position, duration)}
        aria-label={t('video.position')}
        onChange={(event) => setDragging(Number(event.target.value))}
        onPointerUp={() => {
          if (dragging !== null) void session.videoSeek({ seconds: dragging });
          setDragging(null);
        }}
        onKeyUp={() => {
          if (dragging !== null) void session.videoSeek({ seconds: dragging });
          setDragging(null);
        }}
      />
      {props.file && has === false && (
        <span className="w-full text-xs text-amber-300" role="status">
          {t('video.notDownloaded')}
        </span>
      )}
    </div>
  );
}
