import type { Song } from '@worship-q/protocol';
import { songMediaKind } from '../app/media';
import { t } from '../i18n';
import { Icon } from './Icon';

// Each badge is `relative` so its `sr-only` label, which is absolutely positioned, stays
// inside the scrolling list. Left unpositioned, labels far down a long library escape it and
// stretch the window's own scroll height.

/** The kinds of item that carry a badge, each with its own colour and icon (U12). */
export type BadgeKind = 'slides' | 'pdf' | 'image' | 'video' | 'website';

/**
 * Full class names, so Tailwind finds them. Sky and amber are left out: they already mean
 * selected and removed.
 */
const BADGE_COLOURS: Record<BadgeKind, string> = {
  slides: 'bg-orange-500/20 text-orange-300',
  pdf: 'bg-rose-500/20 text-rose-300',
  image: 'bg-emerald-500/20 text-emerald-300',
  video: 'bg-violet-500/20 text-violet-300',
  website: 'bg-fuchsia-500/20 text-fuchsia-300',
};

const LABELS = {
  slides: 'songs.deckBadge',
  pdf: 'songs.pdfBadge',
  image: 'songs.imageBadge',
  video: 'songs.videoBadge',
  website: 'songs.websiteBadge',
} as const;

/**
 * The badge a song gets, or null for an ordinary song. A deck from before decks had a kind
 * is slides, or a PDF when its file was one.
 */
export function badgeKind(song: Pick<Song, 'deck' | 'website' | 'video'>): BadgeKind | null {
  if (song.website) return 'website';
  return songMediaKind({ ...song, video: song.video ?? null });
}

/** The label of a kind's badge, for screen readers and on hover. */
export function badgeLabel(kind: BadgeKind): string {
  return t(LABELS[kind]);
}

/** Marks media and websites wherever songs are listed; nothing for an ordinary song. */
export function DeckBadge(props: { song: Pick<Song, 'deck' | 'website' | 'video'> }) {
  const kind = badgeKind(props.song);
  if (!kind) return null;
  return <KindBadge kind={kind} />;
}

/** A kind's badge on its own, as for an upload not yet made into a song. */
export function KindBadge(props: { kind: BadgeKind }) {
  const label = badgeLabel(props.kind);
  return (
    <span
      className={`relative mr-1.5 inline-flex rounded p-0.5 align-middle ${BADGE_COLOURS[props.kind]}`}
      title={label}
    >
      <Icon name={props.kind} className="h-3 w-3" />
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
