import type { ServerInfo } from '@worship-q/protocol';

/** How often the server's info is asked for again when it lacks nothing, in sync ticks. */
export const INFO_EVERY_TICKS = 10;

/**
 * Whether to ask the server's info again on this sync tick: every minute while the last
 * answer is missing or offered no Bible, as when this app started while the server was
 * restarting or before the church chose versions, else every ten minutes.
 */
export function infoDue(info: ServerInfo | null, tick: number): boolean {
  if (!info || info.bible !== true) return true;
  return tick % INFO_EVERY_TICKS === 0;
}
