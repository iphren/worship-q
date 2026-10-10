import type { MonitorIdentity } from '@worship-q/protocol';
import { useSyncExternalStore } from 'react';
import { useApp } from '../app/context';
import type { OutputStatus } from '../app/output';
import { t } from '../i18n';
import { monitorLabel, sameMonitor } from '../lib/monitors';

export function useOutputStatus(): OutputStatus {
  const { output } = useApp();
  return useSyncExternalStore(output.subscribe, () => output.status);
}

function statusText(status: OutputStatus): string {
  const name = (monitor: MonitorIdentity) => monitorLabel(monitor, status.labels);
  switch (status.decision.kind) {
    case 'unset':
      return t('output.unset');
    case 'closed':
      return t('output.closed');
    case 'missing':
      return t('output.missing');
    case 'operator-screen':
      return t('output.operatorScreen', { name: name(status.decision.monitor) });
    case 'open':
      return t('output.open', { name: name(status.decision.monitor) });
  }
}

/** True when the operator should look at the slideshow screen status. */
export function outputNeedsAttention(status: OutputStatus): boolean {
  return status.error !== null || !['open', 'closed'].includes(status.decision.kind);
}

/**
 * Shows where the slideshow is and lets the operator pick its screen. Picking a screen does
 * nothing by itself: the slideshow opens on the picked screen the next time it is opened.
 */
export function OutputPanel() {
  const { output } = useApp();
  const status = useOutputStatus();
  const { decision, monitors, labels, operator, selected } = status;
  const current = decision.kind === 'open' ? decision.monitor : null;
  const isOperator = (monitor: MonitorIdentity) =>
    operator !== null && sameMonitor(monitor, operator);
  const others = monitors.filter((monitor) => !isOperator(monitor));
  const warn = outputNeedsAttention(status);

  return (
    <div className="space-y-2 text-sm">
      <p className={warn ? 'text-amber-300' : 'text-slate-300'}>{statusText(status)}</p>
      {status.error && (
        <p className="text-rose-300">{t('output.failed', { error: status.error })}</p>
      )}
      {others.length === 0 && <p className="text-slate-400">{t('output.noSecondScreen')}</p>}
      <ul className="space-y-1">
        {monitors.map((monitor) => {
          const picked = selected !== null && sameMonitor(selected, monitor);
          return (
            <li key={`${monitor.name}:${monitor.x}:${monitor.y}`}>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 ${
                  picked
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-transparent bg-slate-900/60 hover:bg-slate-900'
                }`}
              >
                <input
                  type="radio"
                  name="output-monitor"
                  className="shrink-0 accent-sky-500"
                  checked={picked}
                  onChange={() => output.select(monitor)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{monitorLabel(monitor, labels) || '—'}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {monitor.width}×{monitor.height}
                    {isOperator(monitor) ? ` · ${t('output.thisScreen')}` : ''}
                  </span>
                </span>
                {current !== null && sameMonitor(current, monitor) && (
                  <span className="shrink-0 text-xs font-medium text-emerald-400">
                    {t('output.showing')}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {current === null && selected !== null && isOperator(selected) && (
        <p className="text-xs text-slate-400">{t('output.presentHereHint')}</p>
      )}
      {current !== null && selected !== null && !sameMonitor(current, selected) && (
        <p className="text-xs text-slate-400">
          {t('output.moveHint', { name: monitorLabel(selected, labels) })}
        </p>
      )}
      {current === null ? (
        <button
          className="btn btn-primary btn-sm"
          disabled={selected === null}
          onClick={() => void output.open()}
        >
          {t('output.openAction')}
        </button>
      ) : (
        <button className="btn btn-sm" onClick={() => void output.close()}>
          {t('output.closeAction')}
        </button>
      )}
    </div>
  );
}
