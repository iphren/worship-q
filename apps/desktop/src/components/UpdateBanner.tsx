import { useState } from 'react';
import { useApp, useUpdates } from '../app/context';
import type { UpdateStatus } from '../app/update';
import { t } from '../i18n';
import { useOutputStatus } from './OutputPanel';

/** Offers to restart into a downloaded update, until the operator chooses Later. */
export function UpdateBanner() {
  const { updates } = useApp();
  const status = useUpdates();
  // The restart button follows the slideshow opening and closing.
  useOutputStatus();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (status.kind !== 'ready' || dismissed === status.version) return null;
  const canRestart = updates.canRestart;
  return (
    <div className="flex items-center gap-3 border-b border-sky-700 bg-sky-950 px-4 py-2 text-sm text-sky-100">
      <span className="flex-1">
        {t('update.ready', { version: status.version })}
        {!canRestart && ` ${t('update.closeSlideshowFirst')}`}
      </span>
      <button className="btn btn-sm" onClick={() => setDismissed(status.version)}>
        {t('update.later')}
      </button>
      <button
        className="btn btn-primary btn-sm"
        disabled={!canRestart}
        onClick={() => void updates.restart()}
      >
        {t('update.restart')}
      </button>
    </div>
  );
}

/** One line on the About section: where the update stands, and a way to look for one now. */
export function UpdateStatusLine() {
  const { updates } = useApp();
  const status = useUpdates();
  useOutputStatus();
  const busy = status.kind === 'checking' || status.kind === 'downloading';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400">{describe(status)}</span>
      {status.kind === 'ready' ? (
        <button
          className="btn btn-sm"
          disabled={!updates.canRestart}
          onClick={() => void updates.restart()}
        >
          {t('update.restart')}
        </button>
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
