import { Session, type StartKind } from '@worship-q/session';
import { migrate, Store } from '@worship-q/store';
import { tauriDriver } from '../platform/native';
import { OutputController } from './output';

/** Keeps the live state from expiring while the app is open. */
const HEARTBEAT_MS = 60_000;

export interface Booted {
  session: Session;
  output: OutputController;
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
  return { session, output, start };
}
