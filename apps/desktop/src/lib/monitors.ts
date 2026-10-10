/**
 * Choosing the slideshow monitor safely (spec criterion 4): a remembered monitor is
 * recognised by its name, size and position rather than its index, and lyrics are never
 * sent to the operator's own screen unless the operator asked for that.
 */
import type { MonitorIdentity, OutputTarget } from '@worship-q/protocol';

export type OutputDecision =
  /** No monitor has been chosen yet. */
  | { kind: 'unset' }
  /** The operator closed the slideshow; the monitor stays remembered. */
  | { kind: 'closed' }
  /** The remembered monitor is not connected. */
  | { kind: 'missing' }
  /** The remembered monitor is now the operator's own screen and that was not asked for. */
  | { kind: 'operator-screen'; monitor: MonitorIdentity }
  | { kind: 'open'; monitor: MonitorIdentity };

const sameSize = (a: MonitorIdentity, b: MonitorIdentity) =>
  a.width === b.width && a.height === b.height;
const samePosition = (a: MonitorIdentity, b: MonitorIdentity) => a.x === b.x && a.y === b.y;

export function sameMonitor(a: MonitorIdentity, b: MonitorIdentity): boolean {
  return a.name === b.name && sameSize(a, b) && samePosition(a, b);
}

/**
 * Finds a remembered monitor among those connected. An exact match wins; otherwise the same
 * name and size at a new position (the display arrangement changed), or the same size and
 * position under a new name (some systems name monitors by port number).
 */
export function findMonitor(
  saved: MonitorIdentity,
  available: readonly MonitorIdentity[],
): MonitorIdentity | null {
  return (
    available.find((monitor) => sameMonitor(monitor, saved)) ??
    available.find((monitor) => monitor.name === saved.name && sameSize(monitor, saved)) ??
    available.find((monitor) => sameSize(monitor, saved) && samePosition(monitor, saved)) ??
    null
  );
}

/**
 * The monitor ticked in the list: the operator's own pick, else the remembered monitor, else
 * the first screen the operator is not working on. Picking only takes effect when the
 * slideshow is next opened.
 */
export function selectedMonitor(
  picked: MonitorIdentity | null,
  target: OutputTarget | null,
  available: readonly MonitorIdentity[],
  operator: MonitorIdentity | null,
): MonitorIdentity | null {
  return (
    (picked && findMonitor(picked, available)) ??
    (target && findMonitor(target.monitor, available)) ??
    available.find((monitor) => operator === null || !sameMonitor(monitor, operator)) ??
    null
  );
}

/** The name to show for a monitor: the system's display name when it has one. */
export function monitorLabel(monitor: MonitorIdentity, labels: Record<string, string>): string {
  // Windows names monitors by port, e.g. \\.\DISPLAY2.
  return labels[monitor.name] || monitor.name.replace(/^\\\\\.\\DISPLAY(\d+)$/i, 'Display $1');
}

export function decideOutput(
  target: OutputTarget | null,
  available: readonly MonitorIdentity[],
  operator: MonitorIdentity | null,
): OutputDecision {
  if (!target) return { kind: 'unset' };
  if (!target.enabled) return { kind: 'closed' };
  const monitor = findMonitor(target.monitor, available);
  if (!monitor) return { kind: 'missing' };
  const isOperatorScreen = operator !== null && sameMonitor(monitor, operator);
  if (isOperatorScreen && !target.allowOperatorScreen) return { kind: 'operator-screen', monitor };
  return { kind: 'open', monitor };
}
