// Stands in for Tauri's native core, so the desktop app's own code runs in a plain browser.
// The page half replaces `window.__TAURI_INTERNALS__` the way `@tauri-apps/api/mocks` does;
// every command is passed to `nativeCommand` here in Node, which answers from the seeded
// database or with what a computer with no slideshow, server or OBS would answer.

import type { SqlValue, Statement } from '@worship-q/store';
import type { NodeDriver } from '@worship-q/store/testing';

declare global {
  interface Window {
    __wqInvoke(cmd: string, args: unknown): Promise<unknown>;
    __TAURI_INTERNALS__: Record<string, unknown>;
  }
}

/** Runs in the page before any of its scripts. Must not use anything from outside itself. */
export function installTauriMock(label: string) {
  const callbacks = new Map<number, (data: unknown) => void>();
  const listeners = new Map<string, number[]>();
  let next = 1;
  const transformCallback = (callback?: (data: unknown) => void, once = false) => {
    const id = next++;
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      callback?.(data);
    });
    return id;
  };
  const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case 'plugin:event|listen': {
        const event = args.event as string;
        listeners.set(event, [...(listeners.get(event) ?? []), args.handler as number]);
        return args.handler;
      }
      case 'plugin:event|unlisten':
        return null;
      case 'plugin:event|emit_to':
        // To another window, such as a frame for the slideshow: Node keeps the latest.
        return window.__wqInvoke(cmd, args);
      case 'plugin:event|emit':
        for (const id of listeners.get(args.event as string) ?? [])
          callbacks.get(id)?.({ event: args.event, id, payload: args.payload });
        return null;
    }
    return window.__wqInvoke(cmd, args);
  };
  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback: (id: number) => callbacks.delete(id),
    runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
    callbacks,
    convertFileSrc: (path: string, protocol = 'asset') =>
      `${protocol}://localhost/${encodeURIComponent(path)}`,
    metadata: {
      currentWindow: { label },
      currentWebview: { windowLabel: label, label },
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
}

/** A second screen beside the laptop's, for the slideshow. */
const MONITORS = [
  {
    name: 'Built-in Retina Display',
    position: { x: 0, y: 0 },
    size: { width: 2880, height: 1800 },
    workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 } },
    scaleFactor: 2,
  },
  {
    name: 'Projector',
    position: { x: 2880, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { position: { x: 2880, y: 0 }, size: { width: 1920, height: 1080 } },
    scaleFactor: 1,
  },
];

/** What the app sent to its other windows, by event name: the latest of each. */
export type Sent = Map<string, unknown>;

/** Answers a command from the page. Unknown commands answer null and are listed once. */
export function nativeCommands(
  driver: NodeDriver,
  sent: Sent,
  log = (cmd: string) => console.warn(cmd),
) {
  const unknown = new Set<string>();
  return async (cmd: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (cmd) {
      case 'plugin:event|emit_to':
        sent.set(args.event as string, args.payload);
        return null;
      case 'db_select':
        return driver.select(args.sql as string, (args.params ?? []) as SqlValue[]);
      case 'db_batch':
        return driver.batch(args.statements as Statement[]);
      case 'list_font_families':
        return ['Helvetica Neue', 'Georgia', 'Avenir Next', 'Arial'];
      case 'font_missing_chars':
        return '';
      case 'monitor_labels':
        return { 'Built-in Retina Display': 'Built-in Display', Projector: 'Projector' };
      case 'plugin:window|available_monitors':
        return MONITORS;
      case 'plugin:window|primary_monitor':
      case 'plugin:window|current_monitor':
        return MONITORS[0];
      case 'output_mode':
        return 'fullscreen';
      case 'output_monitor':
        return { name: 'Projector', position: MONITORS[1]!.position, size: MONITORS[1]!.size };
      case 'other_instances':
        return 0;
      case 'list_workspaces':
      case 'list_videos':
        return [];
      case 'video_location':
        return { path: '', exists: false };
      case 'overlay_status':
        return ['http://localhost:4545/overlay', null];
      case 'plugin:updater|check':
        return null;
      case 'plugin:app|version':
        return '0.0.0';
      default:
        if (!unknown.has(cmd)) {
          unknown.add(cmd);
          log(cmd);
        }
        return null;
    }
  };
}
