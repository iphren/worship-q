import { save as saveFile } from '@tauri-apps/plugin-dialog';
import type { Song } from '@worship-q/protocol';
import { useEffect, useState } from 'react';
import { useApp, useCloud, useSession } from '../app/context';
import { replacementKinds, songMediaKind } from '../app/media';
import type { Upload } from '../app/uploads';
import { t } from '../i18n';
import { native } from '../platform/native';
import { chooseMediaFiles, UploadBar, useUploads } from './UploadProgress';

/** Whether this workspace may change the item's file (U26): not a church item it only uses. */
export function canReplace(session: ReturnType<typeof useSession>, song: Song): boolean {
  return !(song.origin === 'church' && !session.store.managesChurch('song', song));
}

/** Why a media file action cannot be used now, or null when it can. */
export interface MediaActionState {
  download: string | null;
  replace: string | null;
  /** Whether Upload new version is offered at all. */
  replaceOffered: boolean;
}

/** The deck ids whose original the server said it does not have, this run. */
const notKept = new Set<string>();

/**
 * Starts **Download original** (U18): asks where to save it, then saves it, from this
 * computer's copy for a video when there is one. Resolves to an error message, or null.
 */
export async function downloadOriginal(
  cloud: ReturnType<typeof useApp>['cloud'],
  song: Song,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<string | null> {
  const name = song.video?.source ?? song.deck?.source ?? song.title;
  const destination = await saveFile({ defaultPath: name });
  if (!destination) return null;
  try {
    await cloud.downloadOriginal(song, destination, onProgress);
    return null;
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === 'no-original' || code === 'not-found') {
      notKept.add(song.id);
      return t('media.notKept');
    }
    if (code === 'not-connected') return t('media.needsServer');
    return t('media.downloadFailed', { message: code });
  }
}

/** Starts **Upload new version…** (U26) with a file dialog of the kinds the item takes. */
export async function uploadNewVersion(
  cloud: ReturnType<typeof useApp>['cloud'],
  song: Song,
): Promise<string | null> {
  const kind = songMediaKind(song);
  if (!kind) return null;
  const [path] = await chooseMediaFiles(replacementKinds(kind));
  if (!path) return null;
  const refused = await cloud.addMedia([path], { kind: 'newVersion', songId: song.id });
  return refused.length > 0 ? t('media.unsupported') : null;
}

/** What the file actions of a media item can do now. */
export function useMediaActionState(song: Song, dirty: boolean): MediaActionState {
  const { cloud } = useApp();
  const session = useSession();
  const status = useCloud();
  const connected = !!status.state?.deviceToken && !!status.state.joinedAt;
  const [localVideo, setLocalVideo] = useState(false);
  useEffect(() => {
    let active = true;
    if (song.video) {
      void native
        .videoLocation(song.video.file)
        .then((where) => active && setLocalVideo(where.exists))
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [song.video]);
  void cloud;
  const download = notKept.has(song.id)
    ? t('media.notKept')
    : connected || localVideo
      ? null
      : t('media.needsServer');
  const replaceOffered = canReplace(session, song);
  const replace = !connected ? t('media.needsServer') : dirty ? t('media.saveFirst') : null;
  return { download, replace, replaceOffered };
}

/**
 * The file actions of a media item in its editor: **Download original** and **Upload new
 * version…**, and **Reconvert** for slides and PDFs (U4, U18, U26), with their bars.
 */
export function MediaActions(props: { song: Song; dirty: boolean; onSaved(song: Song): void }) {
  const { cloud } = useApp();
  const session = useSession();
  const { song } = props;
  const kind = songMediaKind(song);
  const state = useMediaActionState(song, props.dirty);
  const [download, setDownload] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reconverting, setReconverting] = useState(false);
  const uploads = useUploads().filter(
    (upload): upload is Upload =>
      upload.target.kind === 'newVersion' && upload.target.songId === song.id,
  );

  // A new version that is ready shows here at once.
  useEffect(() => {
    for (const upload of uploads) {
      if (upload.stage.kind !== 'done') continue;
      cloud.uploads.dismiss(upload.id);
      void session.store.getSong(song.id).then((fresh) => fresh && props.onSaved(fresh));
    }
  }, [uploads, cloud, session, song.id, props]);

  async function startDownload() {
    setMessage(null);
    setDownload({ done: 0, total: 0 });
    const problem = await downloadOriginal(cloud, song, (done, total) =>
      setDownload({ done, total }),
    );
    setDownload(null);
    setMessage(problem);
  }

  async function startReplace() {
    setMessage(await uploadNewVersion(cloud, song));
  }

  async function reconvert() {
    setMessage(null);
    setReconverting(true);
    try {
      props.onSaved(await cloud.reconvert(song));
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setMessage(
        code === 'no-original' ? t('media.notKept') : t('media.reconvertFailed', { message: code }),
      );
    } finally {
      setReconverting(false);
    }
  }

  if (!kind) return null;
  const percent =
    download && download.total > 0 ? Math.floor((download.done / download.total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={!!state.download || !!download}
          title={state.download ?? undefined}
          onClick={() => void startDownload()}
        >
          {t('media.downloadOriginal')}
        </button>
        {state.replaceOffered && (
          <button
            type="button"
            className="btn"
            disabled={!!state.replace}
            title={state.replace ?? undefined}
            onClick={() => void startReplace()}
          >
            {t('media.uploadNewVersion')}…
          </button>
        )}
        {(kind === 'slides' || kind === 'pdf') && state.replaceOffered && (
          <button
            type="button"
            className="btn"
            disabled={!!state.replace || reconverting}
            title={state.replace ?? t('media.reconvertHint')}
            onClick={() => void reconvert()}
          >
            {t('media.reconvert')}
          </button>
        )}
      </div>
      {download && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-slate-700"
          role="progressbar"
          aria-label={t('media.downloading', { percent })}
          aria-valuenow={percent}
        >
          <div className="h-full rounded-full bg-sky-500" style={{ width: `${percent}%` }} />
        </div>
      )}
      {reconverting && (
        <div className="space-y-0.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
            <div className="processing-stripes h-full w-full" />
          </div>
          <p className="text-[11px] text-slate-400">{t('media.processing')}</p>
        </div>
      )}
      {uploads
        .filter((upload) => upload.stage.kind !== 'done')
        .map((upload) => (
          <div key={upload.id} className="space-y-0.5">
            <p className="truncate text-xs text-slate-300">{upload.name}</p>
            <UploadBar upload={upload} />
          </div>
        ))}
      {message && <p className="text-xs text-rose-300">{message}</p>}
    </div>
  );
}
