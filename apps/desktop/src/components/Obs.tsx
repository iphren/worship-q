/**
 * OBS on the Present page (OBS control plan §3; task breakdown M3.3, M3.4, M5.2): the switch
 * button, the status indicator and the OBS panel. Nothing here is shown unless a computer of
 * the workspace has an active OBS link (O5).
 */
import { liveFavourite, outputElapsed, switchTarget } from '@worship-q/live-state';
import {
  OBS_ERRORS,
  type ObsCommand,
  type ObsConnection,
  type ObsOutput,
  type ObsResult,
} from '@worship-q/protocol';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp, useNow, useObs, useObsImage } from '../app/context';
import type { ObsShared } from '../app/obsShare';
import { t, type MessageKey } from '../i18n';
import { ConfirmDialog } from './Dialog';
import { Icon } from './Icon';

/** A monitor image older than this is shown as stale (M5.2). */
const STALE_MS = 3000;

export function obsErrorText(result: ObsResult): string {
  const known = Object.values(OBS_ERRORS) as string[];
  if (result.error && known.includes(result.error)) {
    return t(`obs.error.${result.error}` as MessageKey);
  }
  return t('obs.failed', { error: result.error ?? String(result.code ?? '') });
}

function statusColor(status: ObsConnection, reachable: boolean): string {
  if (!reachable) return 'bg-slate-500';
  switch (status) {
    case 'connected':
      return 'bg-emerald-400';
    case 'refused':
      return 'bg-rose-500';
    case 'connecting':
      return 'bg-amber-400';
    case 'not-running':
      return 'bg-slate-500';
  }
}

export function obsStatusText(shared: ObsShared): string {
  if (!shared.state) return t('obs.status.off');
  if (!shared.reachable) return t('obs.unreachable');
  return t(`obs.status.${shared.state.status}`);
}

export function ObsStatusDot(props: { shared: ObsShared; className?: string }) {
  const { state, reachable } = props.shared;
  if (!state) return null;
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusColor(state.status, reachable)} ${props.className ?? ''}`}
      aria-hidden="true"
    />
  );
}

/** A duration as h:mm:ss, or m:ss under an hour. */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Runs one command at a time, keeping its failure to show. */
function useObsAction() {
  const { cloud } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = async (action: () => Promise<ObsResult>) => {
    setBusy(true);
    setError(null);
    window.clearTimeout(timer.current);
    try {
      const result = await action();
      if (!result.ok) {
        setError(obsErrorText(result));
        timer.current = window.setTimeout(() => setError(null), 6000);
      }
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    error,
    command: (command: ObsCommand) => run(() => cloud.obs.command(command)),
    switchScene: () => run(() => cloud.obs.switchScene()),
  };
}

/**
 * The switch button (O4): shows which favourite is live and switches to the other. Shown only
 * while OBS is shared (O5); disabled, but kept in place, while OBS is not connected.
 */
export function ObsSwitchButton(props: { compact?: boolean }) {
  const shared = useObs();
  const action = useObsAction();
  const state = shared.state;
  if (!state) return null;
  const target = switchTarget(state);
  const live = liveFavourite(state);
  const usable = state.status === 'connected' && shared.reachable && target !== null;
  const label = target ? t('obs.switchTo', { scene: target }) : t('obs.switchNone');
  const title = [label, obsStatusText(shared), action.error, t('obs.shortcut')]
    .filter(Boolean)
    .join('\n');
  if (props.compact) {
    return (
      <button
        className={`btn relative px-0 py-2 ${live !== null ? 'border-sky-500' : ''} ${action.error ? 'ring-2 ring-rose-500' : ''}`}
        title={title}
        aria-label={label}
        disabled={!usable || action.busy}
        onClick={() => void action.switchScene()}
      >
        <Icon name="switch" />
        <ObsStatusDot shared={shared} className="absolute top-1 right-1" />
      </button>
    );
  }
  return (
    <div className="col-span-2 space-y-1">
      <button
        className="btn w-full justify-center gap-2"
        title={title}
        disabled={!usable || action.busy}
        onClick={() => void action.switchScene()}
      >
        <ObsStatusDot shared={shared} />
        <span className="truncate">{label}</span>
        <KeyHint>/</KeyHint>
      </button>
      {action.error && <p className="text-xs text-rose-300">{action.error}</p>}
    </div>
  );
}

function KeyHint(props: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-600 px-1 text-[10px] text-slate-400">
      {props.children}
    </kbd>
  );
}

const OUTPUTS = [
  { kind: 'stream', label: 'obs.stream', start: 'startStream', stop: 'stopStream' },
  { kind: 'record', label: 'obs.record', start: 'startRecord', stop: 'stopRecord' },
  {
    kind: 'virtualCam',
    label: 'obs.virtualCam',
    start: 'startVirtualCam',
    stop: 'stopVirtualCam',
  },
] as const;

function outputText(output: ObsOutput, elapsed: number | null): string {
  if (output.phase) return t(`obs.phase.${output.phase}`);
  if (!output.active) return t('obs.offState');
  const parts = [elapsed !== null ? formatDuration(elapsed) : t('obs.on')];
  if (output.paused) parts.push(t('obs.paused'));
  return parts.join(' · ');
}

/** The OBS panel (M3.4): scenes, outputs, status and the live monitor. */
export function ObsPanel(props: { watch: boolean }) {
  const { cloud } = useApp();
  const shared = useObs();
  const action = useObsAction();
  const [confirm, setConfirm] = useState<'stopStream' | 'stopRecord' | null>(null);
  const state = shared.state;
  const anyActive = !!state && OUTPUTS.some(({ kind }) => state[kind].active);
  const now = useNow(1000, anyActive || props.watch);

  const shown = state !== null;
  useEffect(() => {
    if (!props.watch || !shown) return;
    return cloud.obs.watchHere();
  }, [cloud, props.watch, shown]);

  if (!state) return null;
  const usable = state.status === 'connected' && shared.reachable;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <ObsStatusDot shared={shared} />
        <span className="min-w-0 flex-1 truncate text-slate-300">{obsStatusText(shared)}</span>
        {!shared.local && (
          <span className="truncate text-xs text-slate-500">{state.ownerName}</span>
        )}
      </div>

      {props.watch && <ObsMonitor now={now} usable={usable} />}

      <div>
        <h3 className="label mb-1">{t('obs.scenes')}</h3>
        {state.scenes.length === 0 ? (
          <p className="text-xs text-slate-500">{t('obs.scenesWhenConnected')}</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-auto">
            {state.scenes.map((scene) => {
              const live = scene === state.currentScene;
              return (
                <li key={scene}>
                  <button
                    className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left ${
                      live
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-transparent bg-slate-900/60 hover:bg-slate-900'
                    } disabled:opacity-60`}
                    disabled={!usable || action.busy || live}
                    onClick={() => void action.command({ type: 'setScene', scene })}
                  >
                    <span className="min-w-0 flex-1 truncate">{scene}</span>
                    {state.favourites.includes(scene) && (
                      <Icon name="switch" className="h-3.5 w-3.5 text-slate-500" />
                    )}
                    {live && (
                      <span className="text-xs font-medium text-emerald-400">{t('obs.live')}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        {OUTPUTS.map(({ kind, label, start, stop }) => {
          const output = state[kind];
          const elapsed = outputElapsed(output, shared.receivedAt, now);
          const running = output.active && output.phase !== 'stopping';
          return (
            <div key={kind} className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${output.active ? (kind === 'virtualCam' ? 'bg-sky-400' : 'bg-rose-500') : 'bg-slate-600'}`}
                aria-hidden="true"
              />
              <span className="w-28 shrink-0">{t(label)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-400 tabular-nums">
                {outputText(output, elapsed)}
              </span>
              <button
                className={`btn btn-sm w-16 shrink-0 ${running ? 'btn-danger' : ''}`}
                disabled={!usable || action.busy || output.phase !== null}
                onClick={() => {
                  if (!running) return void action.command({ type: start });
                  if (stop === 'stopVirtualCam') return void action.command({ type: stop });
                  setConfirm(stop);
                }}
              >
                {running ? t('obs.stop') : t('obs.start')}
              </button>
            </div>
          );
        })}
      </div>

      {action.error && <p className="text-xs text-rose-300">{action.error}</p>}

      {confirm && (
        <ConfirmDialog
          title={t(confirm === 'stopStream' ? 'obs.confirmStopStream' : 'obs.confirmStopRecord')}
          body={t(
            confirm === 'stopStream' ? 'obs.confirmStopStreamBody' : 'obs.confirmStopRecordBody',
          )}
          confirmLabel={t('obs.stop')}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const command = confirm;
            setConfirm(null);
            void action.command({ type: command });
          }}
        />
      )}
    </div>
  );
}

/** The live monitor (O6, M5.2): the latest image, its age shown once it is stale. */
function ObsMonitor(props: { now: number; usable: boolean }) {
  const image = useObsImage();
  const age = image ? props.now - image.receivedAt : null;
  const stale = age !== null && age > STALE_MS;
  return (
    <figure className="space-y-1">
      <div className="relative aspect-video overflow-hidden rounded-md bg-black">
        {image ? (
          <img
            src={image.image}
            alt={t('obs.monitor')}
            className={`h-full w-full object-contain ${stale ? 'opacity-50' : ''}`}
          />
        ) : (
          <p className="flex h-full items-center justify-center text-xs text-slate-500">
            {props.usable ? t('obs.monitorWaiting') : ''}
          </p>
        )}
      </div>
      <figcaption className="flex justify-between text-xs text-slate-500">
        <span>{t('obs.monitor')}</span>
        {stale && (
          <span className="text-amber-300">
            {t('obs.monitorStale', { seconds: Math.round((age ?? 0) / 1000) })}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** The panel behind one toolbar button; it opens upwards, over the page, like the screen menu. */
export function ObsMenu() {
  const shared = useObs();
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      // A confirmation dialog belongs to the menu even though it is drawn elsewhere.
      const target = event.target as Element;
      if (!holder.current?.contains(target) && !target.closest('[data-dialog]')) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-dialog]')) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!shared.state) return null;
  const title = shared.local
    ? t('obs.panel')
    : t('obs.panelTitle', { name: shared.state.ownerName });
  return (
    <div ref={holder} className="relative flex flex-col">
      <button
        className={`btn relative px-0 py-2 ${open ? 'bg-slate-600' : ''}`}
        title={`${title}\n${obsStatusText(shared)}`}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="camera" />
        <ObsStatusDot shared={shared} className="absolute top-1 right-1" />
      </button>
      {open && (
        <div className="panel absolute right-0 bottom-full z-20 mb-2 w-80 space-y-2 bg-slate-800 p-3 shadow-xl">
          <h2 className="label">{title}</h2>
          <ObsPanel watch />
        </div>
      )}
    </div>
  );
}

/**
 * The OBS switch button's shortcut on the Present page (M3.6). Typing in a field or a dialog
 * being open leaves the key alone.
 */
export function useObsShortcut(): void {
  const { cloud } = useApp();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable || document.querySelector('[data-dialog]')) return;
      if (!cloud.obs.view.state) return;
      event.preventDefault();
      void cloud.obs.switchScene();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cloud]);
}

/**
 * OBS beside the output controls: the switch button and the panel (M3.3, M3.4). The monitor
 * is left out on the OBS computer itself, where OBS is on screen anyway; the camera button's
 * panel shows it there on request.
 */
export function ObsSection(props: { watch: boolean }) {
  const shared = useObs();
  if (!shared.state) return null;
  return (
    <section className="panel space-y-2 p-3">
      <h2 className="label">
        {shared.local ? t('obs.panel') : t('obs.panelTitle', { name: shared.state.ownerName })}
      </h2>
      <ObsSwitchButton />
      <ObsPanel watch={props.watch && !shared.local} />
    </section>
  );
}
