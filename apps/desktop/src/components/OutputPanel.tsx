import type { MonitorIdentity } from '@worship-q/protocol';
import { useSyncExternalStore } from 'react';
import { useApp } from '../app/context';
import type { OutputStatus } from '../app/output';
import { t } from '../i18n';
import { sameMonitor } from '../lib/monitors';

export function useOutputStatus(): OutputStatus {
  const { output } = useApp();
  return useSyncExternalStore(output.subscribe, () => output.status);
}

function statusText(status: OutputStatus, remembered: string): string {
  switch (status.decision.kind) {
    case 'unset':
      return t('output.unset');
    case 'closed':
      return t('output.closed');
    case 'missing':
      return t('output.missing', { name: remembered });
    case 'operator-screen':
      return t('output.operatorScreen', { name: status.decision.monitor.name });
    case 'open':
      return t('output.open', { name: status.decision.monitor.name });
  }
}

/** True when the operator should look at the slideshow screen status. */
export function outputNeedsAttention(status: OutputStatus): boolean {
  return status.error !== null || !['open', 'closed'].includes(status.decision.kind);
}

/** Shows where the slideshow is and lets the operator choose its screen. */
export function OutputPanel(props: { rememberedName: string; hasTarget: boolean }) {
  const { output } = useApp();
  const status = useOutputStatus();
  const { decision, monitors, operator } = status;
  const current = decision.kind === 'open' ? decision.monitor : null;
  const isOperator = (monitor: MonitorIdentity) =>
    operator !== null && sameMonitor(monitor, operator);
  const others = monitors.filter((monitor) => !isOperator(monitor));
  const warn = outputNeedsAttention(status);

  return (
    <div className="space-y-2 text-sm">
      <p className={warn ? 'text-amber-300' : 'text-slate-300'}>
        {statusText(status, props.rememberedName)}
      </p>
      {status.error && (
        <p className="text-rose-300">{t('output.failed', { error: status.error })}</p>
      )}
      {others.length === 0 && <p className="text-slate-400">{t('output.noSecondScreen')}</p>}
      <ul className="space-y-1">
        {monitors.map((monitor) => {
          const inUse = current !== null && sameMonitor(current, monitor);
          const own = isOperator(monitor);
          return (
            <li
              key={`${monitor.name}:${monitor.x}:${monitor.y}`}
              className="flex items-center justify-between gap-2 rounded-md bg-slate-900/60 px-2 py-1.5"
            >
              <span className="min-w-0 truncate">
                {monitor.name || '—'}{' '}
                <span className="text-slate-500">
                  {monitor.width}×{monitor.height}
                  {own ? ` · ${t('output.thisScreen')}` : ''}
                </span>
              </span>
              {inUse ? (
                <span className="text-xs font-medium text-emerald-400">{t('output.inUse')}</span>
              ) : (
                <button
                  className="btn btn-sm shrink-0"
                  title={own ? t('output.presentHereHint') : undefined}
                  onClick={() => void output.choose(monitor, own)}
                >
                  {own ? t('output.presentHere') : t('output.use')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {props.hasTarget && decision.kind === 'closed' && (
        <button className="btn btn-primary btn-sm" onClick={() => void output.setEnabled(true)}>
          {t('output.openAction')}
        </button>
      )}
      {decision.kind === 'open' && (
        <button className="btn btn-sm" onClick={() => void output.setEnabled(false)}>
          {t('output.closeAction')}
        </button>
      )}
    </div>
  );
}
