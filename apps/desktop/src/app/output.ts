/**
 * Runs the slideshow output from the operator window: keeps the output window on the
 * remembered monitor, notices monitors coming and going, and sends it every new frame.
 */
import { emitTo, listen } from '@tauri-apps/api/event';
import { availableMonitors, currentMonitor, type Monitor } from '@tauri-apps/api/window';
import { EMPTY_FRAME, type MonitorIdentity, type OutputFrame } from '@worship-q/protocol';
import type { Session } from '@worship-q/session';
import { decideOutput, type OutputDecision, sameMonitor, selectedMonitor } from '../lib/monitors';
import { type PresentAction, runPresentAction } from '../lib/shortcuts';
import { native } from '../platform/native';

export const OUTPUT_WINDOW = 'output';
export const FRAME_EVENT = 'output-frame';
export const READY_EVENT = 'output-ready';
/** Sent when Esc is pressed on the output window or the system asks to close it. */
export const CLOSE_REQUEST_EVENT = 'output-close-request';
/** Sent by the output window when a presenting shortcut is pressed on it. */
export const ACTION_EVENT = 'output-action';
const MONITOR_POLL_MS = 2000;

export interface OutputStatus {
  frame: OutputFrame;
  /** What the subtitle overlay page shows. */
  subtitle: OutputFrame;
  decision: OutputDecision;
  monitors: MonitorIdentity[];
  /** System display names by monitor name. */
  labels: Record<string, string>;
  /** The monitor the operator window is on. */
  operator: MonitorIdentity | null;
  /** The monitor the slideshow will open on next time it is opened. */
  selected: MonitorIdentity | null;
  /** True while the slideshow is an ordinary window instead of covering a screen. */
  windowed: boolean;
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
    subtitle: { ...EMPTY_FRAME, layout: 'subtitle' },
    decision: { kind: 'unset' },
    monitors: [],
    labels: {},
    operator: null,
    selected: null,
    windowed: false,
    error: null,
  };
  /** The monitor the operator picked in the list since the app opened. */
  private picked: MonitorIdentity | null = null;
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
    this.cleanup.push(await listen(CLOSE_REQUEST_EVENT, () => void this.close()));
    this.cleanup.push(
      await listen<PresentAction>(ACTION_EVENT, (event) => {
        if (this.session.isLive) runPresentAction(this.session, event.payload);
      }),
    );
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
    const subtitle = await this.session.frame(() => '', 'subtitle');
    if (this.stopped) return;
    this.update({ frame, subtitle });
    await this.send();
    await native.publishOverlay(subtitle).catch(console.error);
  }

  private async send(): Promise<void> {
    await emitTo(OUTPUT_WINDOW, FRAME_EVENT, this.status_.frame).catch(() => undefined);
  }

  /**
   * Opens, moves or closes the output window to match the chosen monitor and what is
   * connected. A windowed slideshow is left wherever the operator put it until it is closed.
   */
  private syncWindow(): Promise<void> {
    this.syncing = this.syncing.then(async () => {
      if (this.stopped) return;
      try {
        const [all, current, profile, mode, labels] = await Promise.all([
          availableMonitors(),
          currentMonitor(),
          this.session.store.getOutputProfile(this.session.workspace.id),
          native.outputMode(),
          native.monitorLabels().catch(() => ({})),
        ]);
        const monitors = all.map(identity);
        const operator = current ? identity(current) : null;
        const selected = selectedMonitor(this.picked, profile.target, monitors, operator);
        const decision = decideOutput(profile.target, monitors, operator);
        const before = this.status_.decision;
        const moved =
          decision.kind === 'open' &&
          (before.kind !== 'open' ||
            JSON.stringify(before.monitor) !== JSON.stringify(decision.monitor));

        const isOpen = mode !== null;
        let windowed = mode === 'windowed' && profile.target?.enabled === true;

        let error: string | null = null;
        if (windowed) {
          // Stays where it is, whatever became of the remembered monitor.
        } else if (decision.kind === 'open' && (!isOpen || moved)) {
          // On the operator's own screen it opens in a window, so the app stays in reach.
          const inWindow = !isOpen && operator !== null && sameMonitor(decision.monitor, operator);
          await native.openOutput(decision.monitor, inWindow).then(
            () => (windowed = inWindow),
            (e) => (error = String(e)),
          );
        } else if (decision.kind !== 'open' && isOpen) {
          await native.closeOutput();
        }
        const changed =
          error !== this.status_.error ||
          JSON.stringify([decision, monitors, labels, operator, selected, windowed]) !==
            JSON.stringify([
              before,
              this.status_.monitors,
              this.status_.labels,
              this.status_.operator,
              this.status_.selected,
              this.status_.windowed,
            ]);
        if (changed) {
          this.update({ decision, monitors, labels, operator, selected, windowed, error });
        }
      } catch (e) {
        console.error(e);
      }
    });
    return this.syncing;
  }

  /** Picks the monitor for the next time the slideshow is opened; an open slideshow stays put. */
  select(monitor: MonitorIdentity): void {
    this.picked = monitor;
    this.update({ selected: monitor });
  }

  /** Opens the slideshow on the selected monitor and remembers it as the slideshow screen. */
  async open(): Promise<void> {
    const { selected, operator } = this.status_;
    if (!selected) return;
    // Picking the screen the app is on and choosing Open is asking to present there, in a window.
    const allowOperatorScreen = operator !== null && sameMonitor(selected, operator);
    await this.session.updateOutputProfile({
      target: { monitor: selected, enabled: true, allowOperatorScreen },
    });
  }

  /** Closes the slideshow; its monitor stays remembered. */
  async close(): Promise<void> {
    const profile = await this.session.store.getOutputProfile(this.session.workspace.id);
    if (profile.target) {
      await this.session.updateOutputProfile({ target: { ...profile.target, enabled: false } });
    }
  }

  /** Puts the open slideshow in a window the operator can drag to another screen. */
  async makeWindowed(): Promise<void> {
    this.syncing = this.syncing.then(() => native.windowOutput().catch(console.error));
    await this.syncWindow();
  }

  /**
   * Makes a windowed slideshow cover the screen it is on now, and remembers that screen as
   * the slideshow screen.
   */
  async makeFullScreen(): Promise<void> {
    this.syncing = this.syncing.then(async () => {
      try {
        const monitor = await native.outputMonitor();
        if (!monitor) return;
        const { operator } = this.status_;
        // Dragging the window to the screen the app is on is asking to present there.
        const allowOperatorScreen = operator !== null && sameMonitor(monitor, operator);
        await this.session.updateOutputProfile({
          target: { monitor, enabled: true, allowOperatorScreen },
        });
        this.picked = null;
        await native.openOutput(monitor, false);
      } catch (e) {
        console.error(e);
      }
    });
    await this.syncWindow();
  }
}
