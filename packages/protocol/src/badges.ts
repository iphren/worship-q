/**
 * Which badge an item carries wherever songs are listed: on the desktop, on phones and on the
 * admin pages (U12). Each kind has its own icon and colour, drawn by `@worship-q/ui`.
 */
import { z } from 'zod';
import type { Song } from './records';

/** What a media song shows. */
export type MediaKind = 'slides' | 'pdf' | 'image' | 'video';

export const ItemBadgeSchema = z.enum(['slides', 'pdf', 'image', 'video', 'website', 'bible']);
/** The kinds of item that carry a badge; an ordinary song carries none. */
export type ItemBadge = z.infer<typeof ItemBadgeSchema>;

/** What a media song shows, for its badge and editor; null for lyrics and websites. */
export function songMediaKind(
  song: Pick<Song, 'deck' | 'website'> & { video?: Song['video'] },
): MediaKind | null {
  if (song.video) return 'video';
  if (!song.deck) return null;
  if (song.deck.kind === 'image') return 'image';
  return /\.pdf$/i.test(song.deck.source) ? 'pdf' : 'slides';
}

/** The badge a song gets, or null for an ordinary song. */
export function songBadge(
  song: Pick<Song, 'deck' | 'website'> & { video?: Song['video']; passage?: Song['passage'] },
): ItemBadge | null {
  if (song.passage) return 'bible';
  if (song.website) return 'website';
  return songMediaKind(song);
}

/**
 * The badge of an item sent to another device. One from a device before badges were sent
 * has only its kind, so imported slides of every sort read as slides.
 */
export function itemBadge(item: {
  kind?: 'lyrics' | 'deck' | 'website' | 'video' | 'passage';
  badge?: ItemBadge;
}): ItemBadge | null {
  if (item.badge) return item.badge;
  switch (item.kind) {
    case 'deck':
      return 'slides';
    case 'website':
    case 'video':
      return item.kind;
    case 'passage':
      return 'bible';
    default:
      return null;
  }
}
