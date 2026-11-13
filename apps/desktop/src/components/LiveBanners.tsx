import { useEffect } from 'react';
import { useApp, useAudio, useCloud } from '../app/context';
import { t } from '../i18n';

/** The "another computer carried on" notice clears itself after this long. */
const DEMOTED_NOTICE_MS = 8000;

/**
 * What the operator must know about the shared live state, wherever they are in the app:
 * the coordinator stopped responding (decision D18), another computer took over (plan
 * M4.5; clears itself, as the sidebar keeps showing the role), or a device lacks the workspace's font (plan M8.5).
 */
export function LiveBanners() {
  const { cloud, session } = useApp();
  const { live, relay } = useCloud();
  const audio = useAudio();
  const demoted = live?.demoted ?? false;
  useEffect(() => {
    if (!demoted) return;
    const timer = setTimeout(() => cloud.dismissDemoted(), DEMOTED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [demoted, cloud]);
  // The broadcast is silent until this window is seen (A19): said wherever the operator is,
  // also without a church connection.
  const hidden = audio.switchOn && audio.input === 'hidden' && (
    <div className="notice m-0 rounded-none border-x-0 border-t-0 border-amber-500 bg-amber-900/40 text-amber-100">
      <span className="flex-1">
        {t('audio.status.hidden')}. {t('audio.advice.hidden')}
      </span>
    </div>
  );
  if (!live || relay.kind !== 'connected') return hidden || null;
  const lost = live.coordinatorLost && live.role !== 'coordinator';
  return (
    <>
      {hidden}
      {lost && (
        <div className="notice m-0 rounded-none border-x-0 border-t-0 border-amber-500 bg-amber-900/40 text-amber-100">
          <span className="flex-1">{t('live.lost')}</span>
          {!session.isViewer && (
            <button
              className="btn btn-primary btn-sm"
              title={t('live.carryOnHint')}
              onClick={() => cloud.takeOver()}
            >
              {t('live.carryOn')}
            </button>
          )}
        </div>
      )}
      {live.demoted && (
        <div className="notice m-0 rounded-none border-x-0 border-t-0 border-sky-600 bg-sky-900/40 text-sky-100">
          <span className="flex-1">{t('live.demoted')}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => cloud.dismissDemoted()}>
            {t('present.dismiss')}
          </button>
        </div>
      )}
      {live.role === 'coordinator' &&
        live.fontWarnings.map((warning) => (
          <div
            key={warning.name}
            className="notice m-0 rounded-none border-x-0 border-t-0 border-amber-500 bg-amber-900/30 text-amber-100"
          >
            {t('live.fontWarning', { name: warning.name, fonts: warning.fonts.join(', ') })}
          </div>
        ))}
    </>
  );
}
