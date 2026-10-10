/**
 * Runs the slideshow output from the operator window: keeps the output window on the
 * remembered monitor, notices monitors coming and going, and sends it every new frame.
 */
import { emitTo, listen } from '@tauri-apps/api/event';
import { availableMonitors, currentMonitor, type Monitor } from '@tauri-apps/api/window';
import { EMPTY_FRAME, type MonitorIdentity, type OutputFrame } from '@worship-q/protocol';
import type { Session } from '@worship-q/session';
import { decideOutput, type OutputDecision } from '../lib/monitors';
import { native } from '../platform/native';

export const OUTPUT_WINDOW = 'output';
export const FRAME_EVENT = 'output-frame';
export const READY_EVENT = 'output-ready';
/** Sent by the output window when Esc is pressed on it. */
export const CLOSE_REQUEST_EVENT = 'output-close-request';
const MONITOR_POLL_MS = 2000;

export interface OutputStatus {
  frame: OutputFrame;
  decision: OutputDecision;
  monitors: MonitorIdentity[];
  /** The monitor the operator window is on. */
  operator: MonitorIdentity | null;
  error: string | null;
}

const identity = (monitor: Monitor): MonitorIdentity => ({
  name: monitor.name ?? '',
  x: monitor.position.x,
  y: monitor.position.y,
  width: monitor.size.width,
  height: monitor.size.height,
});

export class OutputController {
  private status_: OutputStatus = {
    frame: EMPTY_FRAME,
    decision: { kind: 'unset' },
    monitors: [],
    operator: null,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly urls = new Map<string, string | null>();
  private stopped = false;
  private syncing: Promise<void> = Promise.resolve();
  private cleanup: (() => void)[] = [];

  constructor(private readonly session: Session) {}

  get status(): OutputStatus {
    return this.status_;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<OutputStatus>): void {
    this.status_ = { ...this.status_, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  async start(): Promise<void> {
    this.cleanup.push(this.session.subscribe(() => void this.refresh()));
    this.cleanup.push(await listen(READY_EVENT, () => void this.send()));
    this.cleanup.push(await listen(CLOSE_REQUEST_EVENT, () => void this.setEnabled(false)));
    const timer = window.setInterval(() => void this.syncWindow(), MONITOR_POLL_MS);
    this.cleanup.push(() => window.clearInterval(timer));
    await this.refresh();
  }

  stop(): void {
    this.stopped = true;
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
  }

  private async refresh(): Promise<void> {
    await Promise.all([this.refreshFrame(), this.syncWindow()]);
  }

  /** Forget cached file locations, after backgrounds were added or removed. */
  forgetFiles(): void {
    this.urls.clear();
  }

  private async refreshFrame(): Promise<void> {
    const backgrounds = await this.session.store.listBackgrounds(this.session.workspace.id);
    for (const asset of backgrounds) {
      if (!this.urls.has(asset.fileName)) {
        this.urls.set(asset.fileName, await native.backgroundUrl(asset.fileName));
      }
    }
    const frame = await this.session.frame((asset) => this.urls.get(asset.fileName) ?? '');
    // A selected background whose file is missing falls back to the solid color.
    if (frame.background.media && !frame.background.media.url) frame.background.media = null;
    if (this.stopped) return;
    this.update({ frame });
    await this.send();
  }

  private async send(): Promise<void> {
    await emitTo(OUTPUT_WINDOW, FRAME_EVENT, this.status_.frame).catch(() => undefined);
  }

  /** Opens, moves or closes the output window to match the chosen monitor and what is connected. */
  private syncWindow(): Promise<void> {
    this.syncing = this.syncing.then(async () => {
      if (this.stopped) return;
      try {
        const [all, current, profile, isOpen] = await Promise.all([
          availableMonitors(),
          currentMonitor(),
          this.session.store.getOutputProfile(this.session.workspace.id),
          native.outputIsOpen(),
        ]);
        const monitors = all.map(identity);
        const operator = current ? identity(current) : null;
        const decision = decideOutput(profile.target, monitors, operator);
        const before = this.status_.decision;
        const moved =
          decision.kind === 'open' &&
          (before.kind !== 'open' ||
            JSON.stringify(before.monitor) !== JSON.stringify(decision.monitor));

        let error: string | null = null;
        if (decision.kind === 'open' && (!isOpen || moved)) {
          await native.openOutput(decision.monitor).catch((e) => (error = String(e)));
        } else if (decision.kind !== 'open' && isOpen) {
          await native.closeOutput();
        }
        const changed =
          error !== this.status_.error ||
          JSON.stringify([decision, monitors, operator]) !==
            JSON.stringify([before, this.status_.monitors, this.status_.operator]);
        if (changed) this.update({ decision, monitors, operator, error });
      } catch (e) {
        console.error(e);
      }
    });
    return this.syncing;
  }

  /** Remembers a monitor as the slideshow screen and opens the slideshow on it. */
  async choose(monitor: MonitorIdentity, allowOperatorScreen = false): Promise<void> {
    await this.session.updateOutputProfile({
      target: { monitor, enabled: true, allowOperatorScreen },
    });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const profile = await this.session.store.getOutputProfile(this.session.workspace.id);
    if (profile.target) {
      await this.session.updateOutputProfile({ target: { ...profile.target, enabled } });
    }
  }
}
