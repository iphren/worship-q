import { useState } from 'react';
import { useApp, useUpdates } from '../app/context';
import type { UpdateStatus } from '../app/update';
import { t } from '../i18n';
import { ConfirmDialog } from './Dialog';
import { useOutputStatus } from './OutputPanel';

/** Offers to restart into a downloaded update. It stays until the operator restarts. */
export function UpdateBanner() {
  const status = useUpdates();
  if (status.kind !== 'ready') return null;
  return (
    <div className="flex items-center gap-3 border-b border-sky-700 bg-sky-950 px-4 py-2 text-sm text-sky-100">
      <span className="flex-1">{t('update.ready', { version: status.version })}</span>
      <RestartButton version={status.version} />
    </div>
  );
}

/** One line on the About section: where the update stands, and a way to look for one now. */
export function UpdateStatusLine() {
  const { updates } = useApp();
  const status = useUpdates();
  const busy = status.kind === 'checking' || status.kind === 'downloading';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400">{describe(status)}</span>
      {status.kind === 'ready' ? (
        <RestartButton version={status.version} />
      ) : (
        status.kind !== 'installing' && (
          <button className="btn btn-sm" disabled={busy} onClick={() => void updates.check()}>
            {t('update.check')}
          </button>
        )
      )}
    </div>
  );
}

/**
 * Restarts into the downloaded update after asking. Red while the slideshow is open, because
 * restarting closes it.
 */
function RestartButton(props: { version: string }) {
  const { updates } = useApp();
  // The colour and the warning follow the slideshow opening and closing.
  useOutputStatus();
  const [confirming, setConfirming] = useState(false);
  const slideshowOpen = updates.slideshowOpen;
  return (
    <>
      <button
        className={`btn btn-sm ${slideshowOpen ? 'btn-danger' : 'btn-primary'}`}
        onClick={() => setConfirming(true)}
      >
        {t('update.restart')}
      </button>
      {confirming && (
        <ConfirmDialog
          title={t('update.confirmTitle')}
          body={t(slideshowOpen ? 'update.confirmBodySlideshow' : 'update.confirmBody', {
            version: props.version,
          })}
          confirmLabel={t('update.restart')}
          danger={slideshowOpen}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void updates.restart();
          }}
        />
      )}
    </>
  );
}

function describe(status: UpdateStatus): string {
  switch (status.kind) {
    case 'idle':
      return '';
    case 'checking':
      return t('update.checking');
    case 'current':
      return t('update.current');
    case 'downloading':
      return t('update.downloading', { version: status.version });
    case 'ready':
      return t('update.readyShort', { version: status.version });
    case 'installing':
      return t('update.installing', { version: status.version });
    case 'failed':
      return t('update.failed');
  }
}
