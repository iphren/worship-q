import { useApp, useCloud } from '../app/context';
import { t } from '../i18n';

/**
 * What the operator must know about the shared live state, wherever they are in the app:
 * the coordinator stopped responding (decision D18), another computer took over (plan
 * M4.5), or a device lacks the workspace's font (plan M8.5).
 */
export function LiveBanners() {
  const { cloud, session } = useApp();
  const { live, relay } = useCloud();
  if (!live || relay.kind !== 'connected') return null;
  const lost = live.coordinatorLost && live.role !== 'coordinator';
  return (
    <>
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
