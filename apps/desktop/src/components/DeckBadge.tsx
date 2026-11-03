import type { Song } from '@worship-q/protocol';
import { useSession } from '../app/context';
import { t } from '../i18n';

/**
 * Marks an imported slide deck or a website wherever songs are listed; nothing for an
 * ordinary song.
 */
export function DeckBadge(props: { song: Song }) {
  if (!props.song.deck && !props.song.website) return null;
  return (
    <span className="mr-1.5 inline-block rounded bg-slate-700 px-1 align-middle text-[10px] leading-4 font-semibold tracking-wide text-slate-300 uppercase">
      {props.song.website ? t('songs.websiteBadge') : t('songs.deckBadge')}
    </span>
  );
}

/**
 * Where a song comes from (D31): the Church Library's, or one with two versions. Nothing for
 * the workspace's own, and nothing in a workspace that manages the Church Library, where
 * every song is the church's.
 */
export function OriginBadge(props: { song: Song }) {
  const session = useSession();
  const { song } = props;
  if (session.store.managesChurchLibrary) return null;
  const label = song.versions
    ? t('songs.versionsBadge')
    : song.origin === 'church'
      ? t('songs.churchBadge')
      : null;
  if (!label) return null;
  return (
    <span
      className={`mr-1.5 inline-block rounded px-1 align-middle text-[10px] leading-4 font-semibold tracking-wide uppercase ${
        song.versions ? 'bg-amber-900/70 text-amber-200' : 'bg-sky-900/70 text-sky-200'
      }`}
    >
      {label}
    </span>
  );
}
