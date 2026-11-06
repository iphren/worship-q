import type { Song } from '@worship-q/protocol';
import { t } from '../i18n';
import { Icon } from './Icon';

// Each badge is `relative` so its `sr-only` label, which is absolutely positioned, stays
// inside the scrolling list. Left unpositioned, labels far down a long library escape it and
// stretch the window's own scroll height.

/**
 * Marks an imported slide deck or a website wherever songs are listed; nothing for an
 * ordinary song.
 */
export function DeckBadge(props: { song: Song }) {
  if (!props.song.deck && !props.song.website) return null;
  const label = props.song.website ? t('songs.websiteBadge') : t('songs.deckBadge');
  return (
    <span
      className="relative mr-1.5 inline-flex rounded bg-slate-700 p-0.5 align-middle text-slate-300"
      title={label}
    >
      <Icon name={props.song.website ? 'website' : 'slides'} className="h-3 w-3" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Marks a song pinned to the top of the library. */
export function PinnedMark() {
  return (
    <span
      className="relative mr-1.5 inline-flex align-middle text-sky-400"
      title={t('library.pinned')}
    >
      <Icon name="pin" className="h-3 w-3" />
      <span className="sr-only">{t('library.pinned')}</span>
    </span>
  );
}
