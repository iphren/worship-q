/**
 * Each workspace's OBS state, as its OBS computer last reported it, for the admin app.
 *
 * The OBS computer reports its own state over HTTP when it changes and every half minute
 * while its link is on; the relay only forwards OBS messages between desktops and never
 * keeps them. The reports are kept in memory: they are transient, and the next one refills
 * them after a restart.
 */
import { newerObsState } from '@worship-q/live-state';
import type { ObsState } from '@worship-q/protocol';

export interface ObsReport {
  state: ObsState;
  /** The device that sent it, which is the state's owner. */
  deviceId: string;
  /** When it arrived, on the server's clock. */
  receivedAt: string;
}

export class ObsReports {
  private readonly reports = new Map<string, ObsReport>();

  constructor(private readonly now: () => string) {}

  /**
   * Keeps the report unless another computer's later activation holds the workspace's OBS
   * state. The same computer's report always replaces its last one: its revisions start
   * again when the app restarts. Returns whether it was kept.
   */
  put(workspaceId: string, deviceId: string, state: ObsState): boolean {
    const current = this.reports.get(workspaceId);
    if (current && current.state.ownerId !== state.ownerId) {
      if (!newerObsState(state, current.state)) return false;
    }
    this.reports.set(workspaceId, { state, deviceId, receivedAt: this.now() });
    return true;
  }

  get(workspaceId: string): ObsReport | null {
    return this.reports.get(workspaceId) ?? null;
  }
}
