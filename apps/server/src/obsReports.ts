/**
 * Each workspace's OBS state, as its OBS computer last reported it, for the admin app.
 *
 * The OBS computer reports its own state over HTTP when it changes and every half minute
 * while its link is on; the relay only forwards OBS messages between desktops and never
 * keeps them. The reports are kept in memory: they are transient, and the next one refills
 * them after a restart.
 */
import { newerObsState } from '@worship-q/live-state';
import type { ObsSnapshot, ObsState } from '@worship-q/protocol';

export interface ObsReport {
  state: ObsState;
  /** The device that sent it, which is the state's owner. */
  deviceId: string;
  /** When it arrived, on the server's clock. */
  receivedAt: string;
  /**
   * The latest image of the program, from this owner's heartbeats; kept across the reports
   * between them, which carry none.
   */
  snapshot: ObsSnapshot | null;
  /** When the image arrived, on the server's clock; its `takenAt` is the OBS computer's. */
  snapshotAt: string | null;
}

export class ObsReports {
  private readonly reports = new Map<string, ObsReport>();

  constructor(private readonly now: () => string) {}

  /**
   * Keeps the report unless another computer's later activation holds the workspace's OBS
   * state. The same computer's report always replaces its last one: its revisions start
   * again when the app restarts. Returns whether it was kept.
   */
  put(
    workspaceId: string,
    deviceId: string,
    state: ObsState,
    snapshot: ObsSnapshot | null = null,
  ): boolean {
    const current = this.reports.get(workspaceId);
    const sameOwner = current?.state.ownerId === state.ownerId;
    if (current && !sameOwner && !newerObsState(state, current.state)) return false;
    const now = this.now();
    const kept = sameOwner ? current : null;
    this.reports.set(workspaceId, {
      state,
      deviceId,
      receivedAt: now,
      snapshot: snapshot ?? kept?.snapshot ?? null,
      snapshotAt: snapshot ? now : (kept?.snapshotAt ?? null),
    });
    return true;
  }

  get(workspaceId: string): ObsReport | null {
    return this.reports.get(workspaceId) ?? null;
  }
}
