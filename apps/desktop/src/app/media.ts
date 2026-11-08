/**
 * What kind of media a file is, and whether this server takes it at its size (media uploads
 * plan, U1, U2, U7, U19, U25). One table of formats serves the checks and the file dialogs.
 */
import type { Deck, MediaLimits, ServerInfo, Song } from '@worship-q/protocol';
import { t } from '../i18n';

export type MediaKind = 'slides' | 'pdf' | 'image' | 'video';

/** Extensions by kind, without the dot, lower case. */
export const MEDIA_FORMATS: Record<MediaKind, readonly string[]> = {
  slides: ['pptx', 'ppsx', 'pptm', 'potx', 'ppt', 'pps', 'odp', 'key'],
  pdf: ['pdf'],
  // HEIC is converted to JPEG on a Mac before it is sent (U25).
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'],
  video: ['mp4', 'm4v', 'mov', 'webm'],
};

const HEIC = ['heic', 'heif'];

/** The last part of a path, whichever separator it uses. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function extensionOf(path: string): string | null {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  // No extension, nothing before it (`.mp4`), or nothing after it (`name.`).
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** A file's kind by its extension alone, ignoring case; null for one Worship Q cannot show. */
export function mediaKindOf(path: string): MediaKind | null {
  const extension = extensionOf(path);
  if (!extension) return null;
  for (const kind of Object.keys(MEDIA_FORMATS) as MediaKind[]) {
    if (MEDIA_FORMATS[kind].includes(extension)) return kind;
  }
  return null;
}

/** An iPhone photo, which must become a JPEG before it is sent (U25). */
export function isHeic(path: string): boolean {
  return HEIC.includes(extensionOf(path) ?? '');
}

/** The extensions a file dialog offers for these kinds. */
export function dialogExtensions(kinds: readonly MediaKind[]): string[] {
  return kinds.flatMap((kind) => MEDIA_FORMATS[kind]);
}

/** Which limit a kind is held to. */
export function limitOf(kind: MediaKind, limits: MediaLimits): number {
  return kind === 'image' ? limits.image : kind === 'video' ? limits.video : limits.deck;
}

const MB = 1024 * 1024;

/**
 * Sizes in MB, rounded the same way. When the file and the limit would read the same, one
 * decimal is shown, so a file just over the limit never reads as equal to it.
 */
export function megabytes(bytes: number, limit: number): [string, string] {
  const whole = (n: number) => String(Math.round(n / MB));
  const tenth = (n: number) => (Math.round((n / MB) * 10) / 10).toFixed(1);
  const [a, b] = [whole(bytes), whole(limit)];
  if (a !== b) return [a, b];
  return [tenth(bytes), tenth(limit)];
}

function kindNoun(kind: MediaKind): string {
  return t(`media.noun.${kind}`);
}

/** Why a file of this size cannot be sent, or null when it can (U2, U7). */
export function sizeProblem(kind: MediaKind, bytes: number, limits: MediaLimits): string | null {
  if (bytes === 0) return t('media.empty');
  const limit = limitOf(kind, limits);
  if (bytes <= limit) return null;
  const [size, max] = megabytes(bytes, limit);
  return t('media.tooBig', { kind: kindNoun(kind), size, limit: max });
}

/** What the server takes (U19): from `info.media`, or slide decks only from an older one. */
export interface MediaOffer {
  decks: boolean;
  images: boolean;
  videos: boolean;
  limits: MediaLimits;
  /** False on a server from before images and videos. */
  current: boolean;
}

/** Limits assumed for a server that does not report its own: its old upload limit. */
const OLD_SERVER_LIMITS: MediaLimits = { image: 0, deck: 2048 * MB, video: 0 };

export function mediaOffer(info: ServerInfo | null): MediaOffer | null {
  if (!info) return null;
  return info.media
    ? {
        decks: info.decks,
        images: info.media.images,
        videos: info.media.videos,
        limits: info.media.limits,
        current: true,
      }
    : {
        decks: info.decks,
        images: false,
        videos: false,
        limits: OLD_SERVER_LIMITS,
        current: false,
      };
}

/** Why the server cannot take a file of this kind, or null when it can (U19). */
export function offerProblem(kind: MediaKind, offer: MediaOffer | null): string | null {
  if (!offer) return t('media.needsServer');
  if (kind === 'image' || kind === 'video') {
    if (!offer.current) return t('media.needsServerUpdate');
    if (kind === 'image' ? !offer.images : !offer.videos) return t('media.needsServerUpdate');
    return null;
  }
  return offer.decks ? null : t('media.decksUnavailable');
}

/** A song's title made from a file's name: without its extension, or "Untitled". */
export function titleFromFile(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : dot === 0 ? '' : name).trim();
  return stem || t('media.untitled');
}

/** What a media song shows, for its badge and editor; null for lyrics and websites. */
export function songMediaKind(
  song: Pick<Song, 'deck' | 'video' | 'website'> & { deck: Deck | null },
): MediaKind | null {
  if (song.video) return 'video';
  if (!song.deck) return null;
  if (song.deck.kind === 'image') return 'image';
  return /\.pdf$/i.test(song.deck.source) ? 'pdf' : 'slides';
}

/** Kinds a new version of a media item may be (U26): any deck kind, or only a video. */
export function replacementKinds(kind: MediaKind): MediaKind[] {
  return kind === 'video' ? ['video'] : ['slides', 'pdf', 'image'];
}
