/**
 * The words for live audio's states (task breakdown M2.9, M3.3), kept apart from the
 * components so every status and note is tested.
 */
import type { DelayFigure, ListenStatus } from '@worship-q/audio';
import type { AudioShared } from '../app/audioShare';
import { t } from '../i18n';

/** The sending computer's status line in Settings. */
export function broadcastStatusText(shared: AudioShared): string {
  if (!shared.switchOn) return t('audio.status.off');
  switch (shared.input) {
    case 'live': {
      const count = shared.local ? (shared.state?.listeners ?? 0) : 0;
      if (count === 0) return t('audio.status.live');
      return count === 1 ? t('audio.status.liveOne') : t('audio.status.liveListeners', { count });
    }
    case 'waiting':
      return shared.inputName
        ? t('audio.status.waiting', { name: shared.inputName })
        : t('audio.status.waitingDefault');
    case 'refused':
      return t('audio.status.refused');
    case 'hidden':
      return t('audio.status.hidden');
    case 'off':
      return t('audio.status.off');
  }
}

/** What to do about the status, when there is something to do; null otherwise. */
export function broadcastAdvice(shared: AudioShared): string | null {
  if (!shared.switchOn) return null;
  switch (shared.input) {
    case 'refused':
      return t('audio.advice.refused');
    case 'hidden':
      return t('audio.advice.hidden');
    case 'waiting':
      return t('audio.advice.waiting');
    default:
      return null;
  }
}

/** The colour of the status dot: live, waiting or wrong. */
export function broadcastTone(shared: AudioShared): 'live' | 'waiting' | 'error' | 'off' {
  if (!shared.switchOn) return 'off';
  if (shared.input === 'live') return 'live';
  if (shared.input === 'refused') return 'error';
  return 'waiting';
}

/** **Listen**'s state in words. */
export function listenStatusText(status: ListenStatus): string {
  switch (status.kind) {
    case 'off':
      return t('listen.status.off');
    case 'connecting':
      return t('listen.status.connecting');
    case 'playing':
      return t('listen.status.playing');
    case 'waiting':
      return t('listen.status.waiting');
    case 'reconnecting':
      return t('listen.status.reconnecting');
    case 'full':
      return t('listen.status.full');
    case 'unreachable':
      return status.relay
        ? t('listen.status.unreachableRelay')
        : t('listen.status.unreachableNone');
  }
}

/** The delay figure and the path, as one line; null while there is nothing to show. */
export function delayText(delay: DelayFigure | null): string | null {
  if (!delay) return null;
  const figure =
    delay.delayMs === null ? t('listen.delayUnknown') : t('listen.delay', { ms: delay.delayMs });
  const path = delay.path ? t(`listen.path.${delay.path}`) : null;
  return path ? `${figure} · ${path}` : figure;
}
