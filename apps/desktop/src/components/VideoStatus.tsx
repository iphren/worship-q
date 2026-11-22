import type { Video } from '@worship-q/protocol';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp, useQuery, useSession } from '../app/context';
import type { CopyStatus } from '../app/videoCache';
import { t } from '@worship-q/i18n/desktop';
import { Icon } from './Icon';
import { native } from '../platform/native';
import { knowsLength, videoPosition } from '@worship-q/live-state';
import { youtubeVideo } from '@worship-q/protocol';
import { useOutputStatus } from './OutputPanel';
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
  // Without a church server the copy is the only one: gone means gone (U30).
  if (status.kind === 'waiting' && !cloud.connected) {
    return <span className="mt-1 block text-xs text-amber-300">{t('video.goneHere')}</span>;
  }
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
  const { cloud } = useApp();
  const has = useHasCopy(props.video.file);
  return (
    <span className="flex flex-col items-center justify-center gap-1 py-1">
      <span className="text-2xl leading-none text-violet-300" aria-hidden>
        ▶
      </span>
      <span className="text-xs text-slate-300">{formatDuration(props.video.durationSeconds)}</span>
      {has === false && (
        <span className="text-[11px] text-amber-300">
          {t(cloud.connected ? 'video.notReady' : 'video.goneHere')}
        </span>
      )}
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
 * The control bar while a video item or a YouTube video is live (M6.4, YouTube control M4.1):
 * play or pause, the position and length, a scrubber, and jumps of 10 seconds. Says so when
 * this computer has no copy to play, or YouTube will not play the video. While a YouTube
 * video's length is not known, and for a live stream, it only plays and pauses (D4).
 */
export function VideoControls(props: { file: string | null }) {
  const { cloud } = useApp();
  const session = useSession();
  const output = useOutputStatus();
  const video = session.video;
  const now = useTicking(!!video?.playing);
  const has = useHasCopy(props.file ?? '');
  const [dragging, setDragging] = useState<number | null>(null);
  if (!video) return null;
  const position = dragging ?? videoPosition(video, new Date(now).toISOString());
  const duration = video.durationSeconds;
  const youtube = output.frame.website ? youtubeVideo(output.frame.website.url)?.id : undefined;
  const live = !!youtube && output.youtubeLive === youtube;
  const seekable = knowsLength(video) && !live;
  // A YouTube video's clock carries its captions when the coordinator can turn them on.
  const captions = video.captions !== undefined && cloud.captionsSupported ? video.captions : null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-800 bg-violet-950/80 px-3 py-2"
      role="group"
      aria-label={t('video.controls')}
    >
      {seekable && (
        <button
          type="button"
          className="btn px-2"
          title={`${t('video.back')} (←)`}
          aria-label={t('video.back')}
          onClick={() => void session.videoSeek({ by: -10 })}
        >
          <Icon name="back10" />
        </button>
      )}
      <button
        type="button"
        className="btn border-violet-500 bg-violet-600 px-4 hover:bg-violet-500"
        title={`${video.playing ? t('video.pause') : t('video.play')} (Space)`}
        aria-label={video.playing ? t('video.pause') : t('video.play')}
        onClick={() => void session.videoPlay(!video.playing)}
      >
        <Icon name={video.playing ? 'pause' : 'play'} />
      </button>
      {seekable && (
        <button
          type="button"
          className="btn px-2"
          title={`${t('video.forward')} (→)`}
          aria-label={t('video.forward')}
          onClick={() => void session.videoSeek({ by: 10 })}
        >
          <Icon name="forward10" />
        </button>
      )}
      <span className="w-24 shrink-0 text-center text-xs text-violet-200 tabular-nums">
        {live
          ? t('video.liveStream')
          : seekable
            ? `${formatDuration(position)} / ${formatDuration(duration)}`
            : formatDuration(position)}
      </span>
      {seekable && (
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
      )}
      {props.file && has === false && (
        <span className="w-full text-xs text-amber-300" role="status">
          {t(cloud.connected ? 'video.notDownloaded' : 'video.goneHere')}
        </span>
      )}
      {captions !== null && (
        <button
          type="button"
          className={`btn px-2 text-xs font-semibold ${captions ? 'border-violet-400 bg-violet-700' : ''}`}
          title={t(captions ? 'video.captionsOff' : 'video.captionsOn')}
          aria-label={t('video.captions')}
          aria-pressed={captions}
          onClick={() => void session.videoCaptions(!captions)}
        >
          CC
        </button>
      )}
      {youtube && output.youtubeError?.id === youtube && (
        <span className="w-full text-xs text-amber-300" role="status">
          {t('video.youtubeRefused')}
        </span>
      )}
    </div>
  );
}
