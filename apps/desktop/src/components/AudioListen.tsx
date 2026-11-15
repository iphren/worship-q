/**
 * Live audio on the Present page (live audio plan §3; task breakdown M2.11, M3.3, M3.6,
 * M3.7): which computer broadcasts, and **Listen** on every other desktop, with its status,
 * the delay figure and the path. On the sending computer, its own status and listeners.
 * Nothing at all when nothing is broadcast.
 */
import { useRef } from 'react';
import { useApp, useAudio, useAudioListen } from '../app/context';
import { t } from '../i18n';
import { Marquee } from '@worship-q/ui';
import { Icon } from './Icon';
import { broadcastStatusText, broadcastTone, delayText, listenStatusText } from './audioText';
import { useInputLevel } from './useInputLevel';

const DOT: Record<ReturnType<typeof broadcastTone>, string> = {
  live: 'bg-emerald-400',
  waiting: 'bg-amber-400',
  error: 'bg-red-500',
  off: 'bg-slate-500',
};

/** How fast the level fill follows a louder input, and how slowly it falls back. */
const FILL_RISE_MS = 120;
const FILL_FALL_MS = 600;

/** The level fill behind the sending computer's status. */
const FILL = 'pointer-events-none absolute inset-0 origin-left bg-emerald-500/15';

export function AudioPanel() {
  const { cloud } = useApp();
  const shared = useAudio();
  const listen = useAudioListen();
  if (shared.local && shared.switchOn) return <BroadcastBanner />;
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
      <Marquee
        className="min-w-0 flex-1"
        title={state ? t('listen.from', { name: state.ownerName }) : undefined}
      >
        {line}
      </Marquee>
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

/**
 * The sending computer's own status, with the input's level as a faint fill behind it: the
 * operator sees the feed arriving without opening Settings.
 */
function BroadcastBanner() {
  const shared = useAudio();
  const fillRef = useRef<HTMLSpanElement>(null);
  const shown = useRef({ level: 0, at: 0 });
  useInputLevel(({ level }) => {
    const fill = fillRef.current;
    if (!fill) return;
    // Eased by elapsed time, so the fill swells and settles instead of following every
    // syllable: quick to rise, slow to fall.
    const now = performance.now();
    const last = shown.current;
    const elapsed = Math.min(now - last.at, 1000);
    const ease = level > last.level ? FILL_RISE_MS : FILL_FALL_MS;
    const next = level + (last.level - level) * Math.exp(-elapsed / ease);
    shown.current = { level: next, at: now };
    fill.style.transform = `scaleX(${next})`;
  });
  return (
    <p className="relative mb-3 flex items-center gap-2 overflow-hidden rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-400">
      <span ref={fillRef} className={FILL} style={{ transform: 'scaleX(0)' }} aria-hidden="true" />
      <span
        className={`relative inline-block h-2 w-2 shrink-0 rounded-full ${DOT[broadcastTone(shared)]}`}
        aria-hidden="true"
      />
      <Marquee className="relative min-w-0 flex-1">
        {t('listen.broadcasting')} · {broadcastStatusText(shared)}
      </Marquee>
    </p>
  );
}
