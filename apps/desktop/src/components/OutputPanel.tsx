import type { MonitorIdentity } from '@worship-q/protocol';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from '../app/context';
import type { OutputStatus } from '../app/output';
import { t } from '../i18n';
import { monitorLabel, sameMonitor } from '../lib/monitors';
import { Icon, type IconName } from './Icon';

export function useOutputStatus(): OutputStatus {
  const { output } = useApp();
  return useSyncExternalStore(output.subscribe, () => output.status);
}

function statusText(status: OutputStatus): string {
  const name = (monitor: MonitorIdentity) => monitorLabel(monitor, status.labels);
  if (status.windowed) return t('output.windowed');
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
  if (status.error !== null) return true;
  return !status.windowed && !['open', 'closed'].includes(status.decision.kind);
}

/**
 * Shows where the slideshow is and lets the operator pick its screen. Picking a screen does
 * nothing by itself: the slideshow opens on the picked screen the next time it is opened.
 *
 * When compact it is a row of icon buttons, with the screens in a menu that opens above it.
 */
export function OutputPanel(props: { compact?: boolean }) {
  const { output } = useApp();
  const status = useOutputStatus();
  const { decision, monitors, labels, operator, selected, windowed } = status;
  const current = decision.kind === 'open' && !windowed ? decision.monitor : null;
  const isOperator = (monitor: MonitorIdentity) =>
    operator !== null && sameMonitor(monitor, operator);
  const others = monitors.filter((monitor) => !isOperator(monitor));
  const warn = outputNeedsAttention(status);

  const screens = (
    <>
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
      {current === null && !windowed && selected !== null && isOperator(selected) && (
        <p className="text-xs text-slate-400">{t('output.presentHereHint')}</p>
      )}
      {current !== null && selected !== null && !sameMonitor(current, selected) && (
        <p className="text-xs text-slate-400">
          {t('output.moveHint', { name: monitorLabel(selected, labels) })}
        </p>
      )}
    </>
  );

  const action = (
    icon: IconName,
    label: string,
    run: () => Promise<unknown>,
    options: { primary?: boolean; danger?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      className={`btn ${options.primary ? 'btn-primary' : options.danger ? 'btn-danger' : ''} ${props.compact ? 'px-0 py-2' : 'btn-sm'}`}
      disabled={options.disabled}
      title={props.compact ? label : undefined}
      aria-label={props.compact ? label : undefined}
      onClick={() => void run()}
    >
      {props.compact ? <Icon name={icon} /> : label}
    </button>
  );
  const closed = current === null && !windowed;
  const mode = closed
    ? action('open', t('output.openAction'), () => output.open(), {
        primary: true,
        disabled: selected === null,
      })
    : windowed
      ? action('fullScreen', t('output.fullScreenAction'), () => output.makeFullScreen(), {
          primary: true,
        })
      : action('windowed', t('output.windowedAction'), () => output.makeWindowed());
  const close = action('close', t('output.closeAction'), () => output.close(), {
    danger: !closed,
    disabled: closed,
  });

  // The toolbar keeps every button in place, so Close stays there, unavailable, while closed.
  if (props.compact) {
    return (
      <>
        <ScreenMenu warn={warn}>{screens}</ScreenMenu>
        {mode}
        {close}
      </>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      {screens}
      <div className="flex flex-wrap gap-2">
        {mode}
        {!closed && close}
      </div>
    </div>
  );
}

/** The screens behind one icon; the menu opens upwards, over the page. */
function ScreenMenu(props: { warn: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={holder} className="relative flex flex-col">
      <button
        className={`btn px-0 py-2 ${open ? 'bg-slate-600' : ''} ${props.warn ? 'ring-2 ring-amber-400' : ''}`}
        title={t('output.title')}
        aria-label={t('output.title')}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="screen" />
      </button>
      {open && (
        <div className="panel absolute bottom-full left-0 z-20 mb-2 w-72 space-y-2 bg-slate-800 p-3 text-sm shadow-xl">
          <h2 className="label">{t('output.title')}</h2>
          {props.children}
        </div>
      )}
    </div>
  );
}
