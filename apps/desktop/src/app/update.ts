/**
 * Keeps the app up to date: looks for a newer release in the background, downloads it, and
 * installs it when the operator restarts, which is never offered while the slideshow is open.
 */
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import type { OutputController } from './output';

/** Leaves the app time to open before using the network. */
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'downloading'; version: string }
  | { kind: 'ready'; version: string }
  | { kind: 'installing'; version: string }
  | { kind: 'failed'; error: string };

export class UpdateController {
  private status_: UpdateStatus = { kind: 'idle' };
  private downloaded: Update | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly output: OutputController) {}

  get status(): UpdateStatus {
    return this.status_;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(status: UpdateStatus): void {
    this.status_ = status;
    for (const listener of [...this.listeners]) listener();
  }

  start(): void {
    // A development build is not an installed copy to replace.
    if (import.meta.env.DEV) return;
    window.setTimeout(() => void this.check(), FIRST_CHECK_MS);
    window.setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  /** Looks for a newer version and downloads it; does nothing while one is under way or ready. */
  async check(): Promise<void> {
    const { kind } = this.status_;
    if (kind === 'checking' || kind === 'downloading' || kind === 'ready' || kind === 'installing')
      return;
    this.update({ kind: 'checking' });
    try {
      const found = await check();
      if (!found) {
        this.update({ kind: 'current' });
        return;
      }
      this.update({ kind: 'downloading', version: found.version });
      await found.download();
      this.downloaded = found;
      this.update({ kind: 'ready', version: found.version });
    } catch (error) {
      console.error(error);
      this.update({ kind: 'failed', error: String(error) });
    }
  }

  /** False while the slideshow is open, so an update never interrupts the screen. */
  get canRestart(): boolean {
    return this.downloaded !== null && this.output.status.decision.kind !== 'open';
  }

  /** Installs the downloaded version and opens it. On Windows the installer reopens the app. */
  async restart(): Promise<void> {
    const update = this.downloaded;
    if (!update || !this.canRestart) return;
    this.update({ kind: 'installing', version: update.version });
    try {
      await update.install();
      await relaunch();
    } catch (error) {
      console.error(error);
      this.downloaded = null;
      this.update({ kind: 'failed', error: String(error) });
    }
  }
}
