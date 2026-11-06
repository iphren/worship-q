/**
 * Settings → OBS on this computer (OBS control plan §3; task breakdown M3.1, M3.2, M3.5):
 * the link's switch, its status with what to do about it, the address and password, OBS's
 * own settings when they can be read, and the switch button's two scenes.
 */
import { useEffect, useState } from 'react';
import { useApp, useObs, useObsLink } from '../app/context';
import { DEFAULT_OBS_ADDRESS, type ObsLinkView } from '../app/obs';
import { t, type MessageKey } from '../i18n';
import { ObsStatusDot } from './Obs';

function linkStatusText(view: ObsLinkView): string {
  const { link } = view;
  if (!view.settings.active) return t('obs.status.off');
  if (view.closing) return t('obs.status.not-running');
  if (link.state === 'connected') {
    return link.obsVersion
      ? t('obs.status.connectedVersion', { version: link.obsVersion })
      : t('obs.status.connected');
  }
  return t(`obs.status.${link.state === 'off' ? 'connecting' : link.state}`);
}

/** What the operator can do about the status, if anything. */
function linkAdvice(view: ObsLinkView): string | null {
  const { link, config } = view;
  if (!view.settings.active) return null;
  if (link.state === 'refused') {
    if (link.refusal === 'other') {
      return t('obs.refused.other', { message: link.message ?? '' });
    }
    return t(`obs.refused.${link.refusal ?? 'authentication'}` as MessageKey);
  }
  if (link.state === 'not-running' || view.closing) {
    // Only OBS's own settings tell a turned-off server from OBS not running (spike M0.5).
    if (config && !config.serverEnabled) return t('obs.serverDisabled');
    return t('obs.waitingHint');
  }
  return null;
}

export function ObsSettings() {
  const { cloud } = useApp();
  const shared = useObs();
  const view = useObsLink();
  const link = cloud.obs.localLink;
  const [address, setAddress] = useState(view?.settings.address ?? DEFAULT_OBS_ADDRESS);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (view) setAddress(view.settings.address);
  }, [view?.settings.address]); // eslint-disable-line react-hooks/exhaustive-deps

  // OBS's own settings are read again each time the page is opened (O12).
  useEffect(() => {
    void link?.refreshConfig();
  }, [link]);

  if (!view || !link) return null;
  const { settings, config } = view;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const connected = view.link.state === 'connected' && view.ready;
  const advice = linkAdvice(view);
  const elsewhere =
    !settings.active && shared.state && !shared.local ? shared.state.ownerName : null;
  const sceneOptions = (current: string | null) => {
    const names = [...view.scenes];
    if (current && !names.includes(current)) names.push(current);
    return names;
  };
  const setFavourite = (index: 0 | 1, scene: string | null) => {
    const next: [string | null, string | null] = [...settings.favourites];
    next[index] = scene;
    link.setFavourites(next);
  };

  return (
    <div className="space-y-4 text-sm">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={settings.active}
          disabled={busy}
          onChange={(event) =>
            void run(() => (event.target.checked ? link.activate() : link.deactivate()))
          }
        />
        <span>
          <span className="block">{t('obs.activate')}</span>
          <span className="block text-xs text-slate-400">{t('obs.activateHint')}</span>
        </span>
      </label>

      {shared.takenOverBy && !settings.active ? (
        <p className="notice border-sky-600 bg-sky-900/30 text-sky-100">
          {t('obs.takenOver', { name: shared.takenOverBy })}
        </p>
      ) : (
        elsewhere && (
          <p className="text-xs text-slate-400">{t('obs.elsewhere', { name: elsewhere })}</p>
        )
      )}

      {settings.active && (
        <div className="space-y-1">
          <p className="flex items-center gap-2">
            {shared.local && <ObsStatusDot shared={shared} />}
            <span>{linkStatusText(view)}</span>
          </p>
          {advice && <p className="text-xs text-slate-400">{advice}</p>}
          {shared.sharingBlocked && (
            <p className="notice border-amber-500 bg-amber-900/30 text-amber-100">
              {t('obs.sharingBlocked')}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-[7rem_1fr] items-start gap-x-3 gap-y-3">
        <label className="pt-1.5" htmlFor="obs-address">
          {t('obs.address')}
        </label>
        <div>
          <input
            id="obs-address"
            className="field w-full"
            value={address}
            spellCheck={false}
            onChange={(event) => setAddress(event.target.value)}
            onBlur={() => void run(() => link.setAddress(address))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void run(() => link.setAddress(address));
            }}
          />
          <p className="mt-1 text-xs text-slate-400">{t('obs.addressHint')}</p>
        </div>

        <label className="pt-1.5" htmlFor="obs-password">
          {t('obs.password')}
        </label>
        <div className="space-y-1">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = password;
              setPassword('');
              void run(() => link.setPassword(value));
            }}
          >
            <input
              id="obs-password"
              type="password"
              className="field min-w-0 flex-1"
              autoComplete="off"
              placeholder={t('obs.passwordPlaceholder')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button className="btn btn-sm" type="submit" disabled={busy || !password}>
              {t('common.save')}
            </button>
          </form>
          <p className="text-xs text-slate-400">
            {config && !config.authRequired
              ? t('obs.noPasswordNeeded')
              : view.hasPassword
                ? t('obs.passwordSaved')
                : t('obs.passwordNone')}
            {view.hasPassword && (
              <button
                className="ml-2 text-sky-300 hover:underline"
                disabled={busy}
                onClick={() => void run(() => link.setPassword(''))}
              >
                {t('obs.passwordRemove')}
              </button>
            )}
          </p>
          {view.passwordUnavailable && (
            <p className="text-xs text-amber-300">{t('obs.passwordUnavailable')}</p>
          )}
        </div>
      </div>

      {config && (
        <div className="flex items-center gap-3">
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void run(() => link.useObsSettings())}
          >
            {t('obs.useObsSettings')}
          </button>
          <span className="text-xs text-slate-400">{t('obs.useObsSettingsHint')}</span>
        </div>
      )}

      {!connected && (
        <div className="rounded-md border border-slate-700 bg-slate-900/50 p-3">
          <h3 className="label mb-1">{t('obs.setupTitle')}</h3>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-300">
            <li>{t('obs.setup1')}</li>
            <li>{t('obs.setup2')}</li>
          </ol>
        </div>
      )}

      <div className="space-y-2">
        <div>
          <h3 className="label">{t('obs.favourites')}</h3>
          <p className="mt-0.5 text-xs text-slate-400">{t('obs.favouritesHint')}</p>
        </div>
        {([0, 1] as const).map((index) => {
          const current = settings.favourites[index];
          return (
            <label key={index} className="grid grid-cols-[7rem_1fr] items-center gap-3">
              <span>{t(index === 0 ? 'obs.favouriteFirst' : 'obs.favouriteSecond')}</span>
              <select
                className="field"
                value={current ?? ''}
                disabled={view.scenes.length === 0 && !current}
                onChange={(event) => setFavourite(index, event.target.value || null)}
              >
                <option value="">{t('obs.favouriteNone')}</option>
                {sceneOptions(current).map((scene) => (
                  <option key={scene} value={scene}>
                    {connected && !view.scenes.includes(scene)
                      ? t('obs.favouriteMissing', { name: scene })
                      : scene}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        {view.scenes.length === 0 && (
          <p className="text-xs text-slate-500">{t('obs.scenesWhenConnected')}</p>
        )}
      </div>
    </div>
  );
}
