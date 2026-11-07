import { Session, type StartKind } from '@worship-q/session';
import { migrate, Store } from '@worship-q/store';
import { tauriDriver } from '../platform/native';
import { CloudController } from './cloud';
import { deviceSettings } from './deviceSettings';
import { OutputController } from './output';
import { UpdateController } from './update';

/** Keeps the live state from expiring while the app is open. */
const HEARTBEAT_MS = 60_000;

export interface Booted {
  session: Session;
  output: OutputController;
  cloud: CloudController;
  updates: UpdateController;
  start: StartKind;
}

/** Opens the database, applies the start rules and starts the slideshow output. */
export async function boot(): Promise<Booted> {
  await migrate(tauriDriver);
  const store = new Store(tauriDriver, {
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
  });
  await store.refreshSearchIndex();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // Viewer mode belongs to this computer, not to the workspace (plan M3.1).
  const role = deviceSettings.get().viewerMode ? 'viewer' : 'operator';
  const { session, start } = await Session.open(store, { now: () => new Date() }, timezone, {
    role,
  });
  window.setInterval(() => void session.heartbeat(), HEARTBEAT_MS);
  const output = new OutputController(session);
  await output.start();
  const cloud = new CloudController(session, output);
  // The app opens without waiting for the network.
  void cloud.start().catch(console.error);
  const updates = new UpdateController(output);
  updates.start();
  return { session, output, cloud, updates, start };
}
