import type { Song } from '@worship-q/protocol';
import { useState } from 'react';
import { t } from '../i18n';
import { Dialog } from './Dialog';
import { ScribblingPencil } from './ScribblingPencil';
import { SongForm, TitleForm, VideoForm } from './SongForm';

/** Songs have lyrics to fix; media and websites only a title (and a video its Autoplay). */
export function isLyrics(song: Pick<Song, 'deck' | 'website' | 'video'>): boolean {
  return !song.deck && !song.website && !song.video;
}

/**
 * A run sheet item's Edit window (U27), over the run sheet: the lyrics editor for a song,
 * the title and Autoplay for a video, and the title for slides, PDFs, images and websites.
 * It edits the song, so the change shows wherever the song is used. Apply saves and stays
 * open; after it, Cancel becomes Close, as what was applied is kept.
 */
export function ItemEditDialog(props: { song: Song; onClose(): void }) {
  const { onClose } = props;
  // The song as last applied, so the form compares its edits with what is saved.
  const [song, setSong] = useState(props.song);
  const applied = song !== props.song;
  const cancel = (
    <button type="button" className="btn" onClick={onClose}>
      {applied ? t('common.close') : t('common.cancel')}
    </button>
  );
  if (isLyrics(song)) {
    return (
      <Dialog
        wide
        title={t('present.editor')}
        icon={<ScribblingPencil />}
        onClose={onClose}
        actions={null}
      >
        <div className="h-[65vh]">
          <SongForm
            key={song.id}
            song={song}
            quick
            onSaved={onClose}
            onApplied={setSong}
            actions={cancel}
          />
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      title={t('present.editor')}
      icon={<ScribblingPencil />}
      onClose={onClose}
      actions={null}
    >
      {song.video ? (
        <VideoForm
          key={song.id}
          song={song}
          video={song.video}
          quick
          onSaved={onClose}
          onApplied={setSong}
          actions={cancel}
        />
      ) : (
        <TitleForm
          key={song.id}
          song={song}
          onSaved={onClose}
          onApplied={setSong}
          actions={cancel}
        />
      )}
    </Dialog>
  );
}
