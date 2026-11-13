/**
 * Live audio on the Present page (live audio plan §3; task breakdown M2.11, M3.3, M3.6,
 * M3.7): which computer broadcasts, and **Listen** on every other desktop, with its status,
 * the delay figure and the path. On the sending computer, its own status and listeners.
 * Nothing at all when nothing is broadcast.
 */
import { useApp, useAudio, useAudioListen } from '../app/context';
import { t } from '../i18n';
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
      <div className="mb-3 rounded-md border border-slate-700 px-3 py-2 text-sm">
        <p className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[broadcastTone(shared)]}`}
            aria-hidden="true"
          />
          <span className="font-medium">{t('listen.broadcasting')}</span>
        </p>
        <p className="text-xs text-slate-400">{broadcastStatusText(shared)}</p>
      </div>
    );
  }
  const state = shared.state;
  const on = listen.status.kind !== 'off';
  if (!state?.active && !on) return null;
  const delay = on ? delayText(listen.delay) : null;
  return (
    <div className="mb-3 space-y-1 rounded-md border border-slate-700 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${
            state?.status === 'live' ? 'bg-emerald-400' : 'bg-amber-400'
          }`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">
          {state ? t('listen.from', { name: state.ownerName }) : listenStatusText(listen.status)}
        </span>
        {cloud.listen && (
          <button
            type="button"
            className={`btn btn-sm ${on ? 'btn-primary' : ''}`}
            title={t('listen.monitorHint')}
            aria-pressed={on}
            onClick={() => (on ? cloud.listen?.stop() : void cloud.listen?.start())}
          >
            {on ? t('listen.stop') : t('listen.listen')}
          </button>
        )}
      </div>
      {on && <p className="text-xs text-slate-400">{listenStatusText(listen.status)}</p>}
      {delay && <p className="text-xs text-slate-500">{delay}</p>}
    </div>
  );
}
