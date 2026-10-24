import type { Song } from '@worship-q/protocol';
import { t } from '../i18n';

/** Marks an imported slide deck wherever songs are listed; nothing for an ordinary song. */
export function DeckBadge(props: { song: Song }) {
  if (!props.song.deck) return null;
  return (
    <span className="mr-1.5 inline-block rounded bg-slate-700 px-1 align-middle text-[10px] leading-4 font-semibold tracking-wide text-slate-300 uppercase">
      {t('songs.deckBadge')}
    </span>
  );
}
