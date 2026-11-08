import type { Song } from '@worship-q/protocol';
import { t } from '../i18n';
import { Dialog } from './Dialog';
import { SongForm, TitleForm, VideoForm } from './SongForm';

/** Songs have lyrics to fix; media and websites only a title (and a video its Autoplay). */
export function isLyrics(song: Pick<Song, 'deck' | 'website' | 'video'>): boolean {
  return !song.deck && !song.website && !song.video;
}

/**
 * A run sheet item's Edit window (U27), over the run sheet: the lyrics editor for a song,
 * the title and Autoplay for a video, and the title for slides, PDFs, images and websites.
 * It edits the song, so the change shows wherever the song is used.
 */
export function ItemEditDialog(props: { song: Song; onClose(): void }) {
  const { song, onClose } = props;
  const cancel = (
    <button type="button" className="btn" onClick={onClose}>
      {t('common.cancel')}
    </button>
  );
  if (isLyrics(song)) {
    return (
      <Dialog wide title={t('present.liveEdit')} onClose={onClose} actions={null}>
        <div className="h-[65vh]">
          <SongForm key={song.id} song={song} quick onSaved={onClose} actions={cancel} />
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title={t('present.liveEdit')} onClose={onClose} actions={null}>
      {song.video ? (
        <VideoForm
          key={song.id}
          song={song}
          video={song.video}
          quick
          onSaved={onClose}
          actions={cancel}
        />
      ) : (
        <TitleForm key={song.id} song={song} onSaved={onClose} actions={cancel} />
      )}
    </Dialog>
  );
}
