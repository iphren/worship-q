import { open as openFile } from '@tauri-apps/plugin-dialog';
import { useSyncExternalStore } from 'react';
import { useApp, useCloud } from '../app/context';
import { dialogExtensions, type MediaKind } from '../app/media';
import { MediaUploads, type Upload } from '../app/uploads';
import { t } from '../i18n';
import { KindBadge } from './DeckBadge';

/** The uploads of this computer, re-rendering the caller when they change. */
export function useUploads(): readonly Upload[] {
  const { cloud } = useApp();
  return useSyncExternalStore(cloud.uploads.subscribe, () => cloud.uploads.list);
}

/**
 * An upload's bar (U15): while being sent, a bar that fills with the share sent and its
 * percentage; while the server works on it, moving stripes; when it failed, the reason with
 * Try again and Dismiss.
 */
export function UploadBar(props: { upload: Upload; compact?: boolean }) {
  const { cloud } = useApp();
  const { upload } = props;
  const { stage } = upload;
  if (stage.kind === 'done') return null;
  if (stage.kind === 'failed') {
    return (
      <div className="space-y-1">
        <p className="text-xs text-rose-300" role="alert">
          {stage.message}
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            onClick={() => cloud.uploads.retry(upload.id)}
          >
            {t('media.tryAgain')}
          </button>
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            onClick={() => cloud.uploads.dismiss(upload.id)}
          >
            {t('media.dismiss')}
          </button>
        </div>
      </div>
    );
  }
  const percent =
    stage.kind === 'uploading' && stage.total > 0
      ? Math.floor((stage.sent / stage.total) * 100)
      : 0;
  const label =
    stage.kind === 'waiting'
      ? t('media.waiting')
      : stage.kind === 'processing'
        ? t('media.processing')
        : t('media.uploading', { percent });
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-slate-700"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={stage.kind === 'uploading' ? percent : undefined}
        >
          {stage.kind === 'processing' ? (
            <div className="processing-stripes h-full w-full" />
          ) : (
            <div
              className="h-full rounded-full bg-sky-500 transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          )}
        </div>
        {!props.compact && <p className="mt-0.5 text-[11px] text-slate-400">{label}</p>}
      </div>
      {MediaUploads.cancellable(upload) && (
        <button
          type="button"
          className="shrink-0 rounded px-1 text-slate-400 hover:bg-slate-600 hover:text-slate-100"
          aria-label={t('media.cancelUpload')}
          title={t('media.cancelUpload')}
          onClick={() => void cloud.uploads.cancel(upload.id)}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** One upload as a row: its badge, its file name, and its bar. */
export function UploadRow(props: { upload: Upload }) {
  const { upload } = props;
  return (
    <div className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1.5">
      <div className="mb-1 flex min-w-0 items-center text-xs text-slate-300">
        <KindBadge kind={upload.kind} />
        <span className="truncate" title={upload.path}>
          {upload.name}
        </span>
      </div>
      <UploadBar upload={upload} />
    </div>
  );
}

/** One message naming the files Worship Q cannot show, or null when there are none. */
export function refusedMessage(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return names.length === 1
    ? `${names[0]}: ${t('media.unsupported')}`
    : t('media.unsupportedList', { names: names.join(', ') });
}

/** Why media cannot be added now, or null when it can (U19). */
export function useMediaBlocked(): string | null {
  const { cloud } = useApp();
  const status = useCloud();
  const connected = !!status.state?.deviceToken && !!status.state.joinedAt;
  if (!connected) return t('media.needsServer');
  const offer = cloud.mediaOffer();
  if (!offer) return t('media.needsServer');
  if (!offer.decks && !offer.images && !offer.videos) return t('media.decksUnavailable');
  return null;
}

/** Opens the file dialog for media; resolves to the files chosen, in order. */
export async function chooseMediaFiles(kinds: readonly MediaKind[] = ALL_KINDS): Promise<string[]> {
  const chosen = await openFile({
    multiple: true,
    filters: [{ name: t('media.dialogName'), extensions: dialogExtensions(kinds) }],
  });
  if (!chosen) return [];
  return Array.isArray(chosen) ? chosen : [chosen];
}

const ALL_KINDS: MediaKind[] = ['slides', 'pdf', 'image', 'video'];
