import type { Song } from '@worship-q/protocol';
import { useSession } from '../app/context';
import { t } from '../i18n';
import { Icon } from './Icon';

/**
 * Marks an imported slide deck or a website wherever songs are listed; nothing for an
 * ordinary song.
 */
export function DeckBadge(props: { song: Song }) {
  if (!props.song.deck && !props.song.website) return null;
  const label = props.song.website ? t('songs.websiteBadge') : t('songs.deckBadge');
  return (
    <span
      className="mr-1.5 inline-flex rounded bg-slate-700 p-0.5 align-middle text-slate-300"
      title={label}
    >
      <Icon name={props.song.website ? 'website' : 'slides'} className="h-3 w-3" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Where a song comes from (D31): the Church Library's, or one with two versions. Nothing for
 * the workspace's own, and nothing for a song of a type the workspace manages in the Church
 * Library, where every such song is the church's.
 */
export function OriginBadge(props: { song: Song }) {
  const session = useSession();
  const { song } = props;
  if (session.store.managesChurch('song', song)) return null;
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
