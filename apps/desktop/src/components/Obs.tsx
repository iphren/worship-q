/**
 * OBS on the Present page (OBS control plan §3; task breakdown M3.3, M3.4, M5.2): the switch
 * button, the status indicator and the OBS panel. Nothing here is shown unless a computer of
 * the workspace has an active OBS link (O5).
 */
import { outputElapsed, switchTarget } from '@worship-q/live-state';
import {
  OBS_ERRORS,
  OBS_SNAPSHOT_EVERY_MS,
  OBS_SNAPSHOT_STALE_MS,
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
export function ObsSwitchButton(props: { small?: boolean }) {
  const shared = useObs();
  const action = useObsAction();
  const state = shared.state;
  if (!state) return null;
  const target = switchTarget(state);
  const usable = state.status === 'connected' && shared.reachable && target !== null;
  const label = target ? t('obs.switchTo', { scene: target }) : t('obs.switchNone');
  const title = [label, obsStatusText(shared), action.error].filter(Boolean).join('\n');
  return (
    <div className="col-span-2 space-y-1">
      <button
        className={`btn btn-switch w-full justify-center ${props.small ? 'btn-sm gap-1.5' : 'gap-2'}`}
        title={title}
        disabled={!usable || action.busy}
        onClick={() => void action.switchScene()}
      >
        {/* Ringed so an amber or green light still shows on the yellow. */}
        <ObsStatusDot shared={shared} className="ring-2 ring-slate-900" />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {action.error && <p className="text-xs text-rose-300">{action.error}</p>}
    </div>
  );
}

type ObsOutputKind = (typeof OUTPUTS)[number]['kind'];

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

/** The colour of an output's light: red while live to the world, blue for the camera. */
function outputDot(kind: ObsOutputKind, active: boolean): string {
  if (!active) return 'bg-slate-600';
  return kind === 'virtualCam' ? 'bg-sky-400' : 'bg-rose-500';
}

function outputText(output: ObsOutput, elapsed: number | null): string {
  if (output.phase) return t(`obs.phase.${output.phase}`);
  if (!output.active) return t('obs.offState');
  const parts = [elapsed !== null ? formatDuration(elapsed) : t('obs.on')];
  if (output.paused) parts.push(t('obs.paused'));
  return parts.join(' · ');
}

/**
 * The OBS panel (M3.4): from the top, the switch button (with `switchButton`), the live monitor,
 * outputs, scenes and status. With `fill` it takes the height it is given: every scene listed,
 * scrolling only when they do not fit, and the status at the bottom.
 */
export function ObsPanel(props: { watch: boolean; fill?: boolean; switchButton?: boolean }) {
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
    <div className={`text-sm ${props.fill ? 'flex min-h-0 flex-1 flex-col gap-3' : 'space-y-3'}`}>
      {props.switchButton && <ObsSwitchButton />}

      {props.watch && <ObsMonitor now={now} usable={usable} />}

      <div className={`space-y-1.5 ${props.fill ? 'border-b border-slate-700 pb-3' : ''}`}>
        {OUTPUTS.map(({ kind, label, start, stop }) => {
          const output = state[kind];
          const elapsed = outputElapsed(output, shared.receivedAt, now);
          const running = output.active && output.phase !== 'stopping';
          return (
            <div key={kind} className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${outputDot(kind, output.active)}`}
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

      <div className={props.fill ? 'flex min-h-0 flex-1 flex-col' : ''}>
        <h3 className="label mb-1">{t('obs.scenes')}</h3>
        {state.scenes.length === 0 ? (
          <p className="text-xs text-slate-500">{t('obs.scenesWhenConnected')}</p>
        ) : (
          <ul className={`space-y-1 overflow-auto ${props.fill ? 'min-h-0' : 'max-h-48'}`}>
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

      {action.error && <p className="text-xs text-rose-300">{action.error}</p>}

      <div
        className={`flex items-center gap-2 ${props.fill ? 'border-t border-slate-700 pt-3' : ''}`}
      >
        <ObsStatusDot shared={shared} />
        <span className="min-w-0 flex-1 truncate text-slate-300">{obsStatusText(shared)}</span>
        {!shared.local && (
          <span className="truncate text-xs text-slate-500">{state.ownerName}</span>
        )}
      </div>

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

/**
 * The live monitor (O6, M5.2): the latest image, its age shown once it is stale. `caption`
 * takes the place of the "Program" label, the age then shown over the image.
 */
function ObsMonitor(props: { now: number; usable: boolean; caption?: ReactNode }) {
  const image = useObsImage();
  const age = image ? props.now - image.receivedAt : null;
  const stale = age !== null && age > OBS_SNAPSHOT_STALE_MS;
  const staleText = t('obs.monitorStale', { seconds: Math.round((age ?? 0) / 1000) });
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
        {image && !stale && (
          <RefreshBar key={image.receivedAt} durationMs={OBS_SNAPSHOT_EVERY_MS} />
        )}
        {stale && props.caption && (
          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] text-amber-300">
            {staleText}
          </span>
        )}
      </div>
      {props.caption ? (
        <figcaption>{props.caption}</figcaption>
      ) : (
        <figcaption className="flex justify-between text-xs text-slate-500">
          <span>{t('obs.monitor')}</span>
          {stale && <span className="text-amber-300">{staleText}</span>}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Sweeps along the monitor's bottom edge, in from the left and out to the right, between one
 * image and the next; each image starts it again.
 */
function RefreshBar(props: { durationMs: number }) {
  return (
    <span
      className="monitor-refresh pointer-events-none absolute bottom-0 left-0 h-0.5 w-1/3 bg-sky-400/80"
      style={{ animationDuration: `${props.durationMs}ms` }}
      aria-hidden="true"
    />
  );
}

/**
 * The live monitor above the slide column on the Present page, shown while OBS is connected,
 * on the OBS computer too, with the switch button and the outputs' lights beside it.
 */
export function ObsLiveMonitor() {
  const { cloud } = useApp();
  const shared = useObs();
  const connected = shared.state?.status === 'connected';
  const now = useNow(1000, connected);
  useEffect(() => {
    if (!connected) return;
    return cloud.obs.watchHere();
  }, [cloud, connected]);
  if (!connected || !shared.state) return null;
  const state = shared.state;
  return (
    // Drawn as a panel, like the side panel, to set it apart from the slides below.
    <div className="panel flex items-start gap-3 overflow-hidden p-3">
      {/* Both sides give way in a narrow window, the switch button's label truncating. */}
      <div className="w-72 min-w-28 shrink">
        <ObsMonitor now={now} usable={shared.reachable} caption={<ObsSwitchButton small />} />
      </div>
      <div className="w-36 min-w-0 shrink">
        <ul className="space-y-2.5 text-xs">
          {OUTPUTS.map(({ kind, label }) => {
            const output = state[kind];
            const elapsed = outputElapsed(output, shared.receivedAt, now);
            return (
              // The state goes under the name, both lined up after the light.
              <li key={kind} className="grid grid-cols-[0.5rem_minmax(0,1fr)] items-center gap-x-2">
                <span
                  className={`h-2 w-2 rounded-full ${outputDot(kind, output.active)}`}
                  aria-hidden="true"
                />
                <span className="truncate">{t(label)}</span>
                <span className="col-start-2 truncate text-slate-400 tabular-nums">
                  {outputText(output, elapsed)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * OBS beside the output controls: the switch button and the panel (M3.3, M3.4). The monitor
 * is left out on the OBS computer itself, where OBS is on screen anyway.
 */
export function ObsSection(props: { watch: boolean }) {
  const shared = useObs();
  if (!shared.state) return null;
  return (
    <section className="panel space-y-2 p-3">
      <h2 className="label">
        {shared.local ? t('obs.panel') : t('obs.panelTitle', { name: shared.state.ownerName })}
      </h2>
      <ObsPanel watch={props.watch && !shared.local} switchButton />
    </section>
  );
}
