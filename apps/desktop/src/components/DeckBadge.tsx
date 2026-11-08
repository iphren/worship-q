import type { Song } from '@worship-q/protocol';
import { t } from '../i18n';
import { Icon } from './Icon';

// Each badge is `relative` so its `sr-only` label, which is absolutely positioned, stays
// inside the scrolling list. Left unpositioned, labels far down a long library escape it and
// stretch the window's own scroll height.

/** The kinds of item that carry a badge, each with its own colour (media plan U12). */
export type BadgeKind = 'slides' | 'website';

/**
 * Full class names, so Tailwind finds them. Sky and amber are left out: they already mean
 * selected and removed.
 */
const BADGE_COLOURS: Record<BadgeKind, string> = {
  slides: 'bg-orange-500/20 text-orange-300',
  website: 'bg-fuchsia-500/20 text-fuchsia-300',
};

/** The badge a song gets, or null for an ordinary song. */
export function badgeKind(song: Song): BadgeKind | null {
  if (song.website) return 'website';
  if (song.deck) return 'slides';
  return null;
}

/**
 * Marks an imported slide deck or a website wherever songs are listed; nothing for an
 * ordinary song.
 */
export function DeckBadge(props: { song: Song }) {
  const kind = badgeKind(props.song);
  if (!kind) return null;
  const label = kind === 'website' ? t('songs.websiteBadge') : t('songs.deckBadge');
  return (
    <span
      className={`relative mr-1.5 inline-flex rounded p-0.5 align-middle ${BADGE_COLOURS[kind]}`}
      title={label}
    >
      <Icon name={kind} className="h-3 w-3" />
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
