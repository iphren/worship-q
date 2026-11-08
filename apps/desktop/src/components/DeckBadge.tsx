import { songBadge, type ItemBadge, type Song } from '@worship-q/protocol';
import { ItemBadgeMark } from '@worship-q/ui';
import { t } from '../i18n';
import { Icon } from './Icon';

/** The kinds of item that carry a badge, each with its own colour and icon (U12). */
export type BadgeKind = ItemBadge;

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
  return songBadge(song);
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
  return <ItemBadgeMark badge={props.kind} label={badgeLabel(props.kind)} className="mr-1.5" />;
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
