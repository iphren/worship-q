/**
 * Live audio on the Present page (live audio plan §3; task breakdown M2.11, M3.3, M3.6,
 * M3.7): which computer broadcasts, and **Listen** on every other desktop, with its status,
 * the delay figure and the path. On the sending computer, its own status and listeners.
 * Nothing at all when nothing is broadcast.
 */
import { useApp, useAudio, useAudioListen } from '../app/context';
import { t } from '../i18n';
import { Icon } from './Icon';
import { broadcastStatusText, broadcastTone, delayText, listenStatusText } from './audioText';

const DOT: Record<ReturnType<typeof broadcastTone>, string> = {
  live: 'bg-emerald-400',
  waiting: 'bg-amber-400',
  error: 'bg-red-500',
  off: 'bg-slate-500',
};

export function AudioPanel() {
  const { cloud } = useApp();
  const shared = useAudio();
  const listen = useAudioListen();
  if (shared.local && shared.switchOn) {
    return (
      <p className="mb-3 flex items-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-400">
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[broadcastTone(shared)]}`}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">
          {t('listen.broadcasting')} · {broadcastStatusText(shared)}
        </span>
      </p>
    );
  }
  const state = shared.state;
  const on = listen.status.kind !== 'off';
  if (!state?.active && !on) return null;
  const line = [
    t('listen.listen'),
    on ? listenStatusText(listen.status) : null,
    on ? delayText(listen.delay) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-400">
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
          state?.status === 'live' ? 'bg-emerald-400' : 'bg-amber-400'
        }`}
        aria-hidden="true"
      />
      <span
        className="min-w-0 flex-1 truncate"
        title={state ? t('listen.from', { name: state.ownerName }) : undefined}
      >
        {line}
      </span>
      {cloud.listen && (
        <button
          type="button"
          className={`btn btn-sm ${on ? 'btn-primary' : ''}`}
          title={`${on ? t('listen.stop') : t('listen.listen')}. ${t('listen.monitorHint')}`}
          aria-label={on ? t('listen.stop') : t('listen.listen')}
          aria-pressed={on}
          onClick={() => (on ? cloud.listen?.stop() : void cloud.listen?.start())}
        >
          <Icon name={on ? 'stop' : 'listen'} className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
