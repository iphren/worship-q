import { Session, type StartKind } from '@worship-q/session';
import { migrate, Store } from '@worship-q/store';
import { tauriDriver } from '../platform/native';
import { CloudController } from './cloud';
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
  const { session, start } = await Session.open(store, { now: () => new Date() }, timezone);
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
