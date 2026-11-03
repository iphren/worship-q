import type { Song } from '@worship-q/protocol';
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
