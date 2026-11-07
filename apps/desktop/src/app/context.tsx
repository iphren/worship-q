import type { Session } from '@worship-q/session';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DependencyList,
} from 'react';
import type { CloudController, CloudStatus } from './cloud';
import type { ObsLinkView } from './obs';
import type { ObsMonitorImage, ObsShared } from './obsShare';
import type { OutputController } from './output';
import type { UpdateController, UpdateStatus } from './update';

export type Page = 'songs' | 'calendar' | 'present' | 'settings';

export interface AppServices {
  session: Session;
  output: OutputController;
  cloud: CloudController;
  updates: UpdateController;
  navigate(page: Page): void;
}

export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const services = useContext(AppContext);
  if (!services) throw new Error('App services are not available');
  return services;
}

/** The session, re-rendering the caller whenever something in it changes. */
export function useSession(): Session {
  const { session } = useApp();
  useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.version,
  );
  return session;
}

/** The church connection's status, re-rendering the caller when it changes. */
export function useCloud(): CloudStatus {
  const { cloud } = useApp();
  return useSyncExternalStore(cloud.subscribe, () => cloud.status);
}

/** The automatic update's status, re-rendering the caller when it changes. */
export function useUpdates(): UpdateStatus {
  const { updates } = useApp();
  return useSyncExternalStore(updates.subscribe, () => updates.status);
}

/** The workspace's OBS state as this desktop shows it (OBS control plan). */
export function useObs(): ObsShared {
  const { cloud } = useApp();
  return useSyncExternalStore(cloud.obs.subscribe, () => cloud.obs.view);
}

/** This computer's OBS link, for Settings → OBS; null until it has started. */
export function useObsLink(): ObsLinkView | null {
  const { cloud } = useApp();
  return useSyncExternalStore(cloud.obs.subscribeLink, () => cloud.obs.localLink?.view ?? null);
}

/** The latest live monitor image while a panel here shows it. */
export function useObsImage(): ObsMonitorImage | null {
  const { cloud } = useApp();
  return useSyncExternalStore(cloud.obs.subscribeImage, () => cloud.obs.image);
}

/** The time now, refreshed every `ms` while `on`, for timers. */
export function useNow(ms = 1000, on = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms, on]);
  return now;
}

/** Remote-control requests and controllers, re-rendering the caller when they change. */
export function useRemoteHost() {
  const { cloud } = useApp();
  useSyncExternalStore(
    (listener) => cloud.host.subscribe(listener),
    () => cloud.host.version,
  );
  return cloud.host;
}

/**
 * Loads data and loads it again whenever the session changes or `deps` change. The previous
 * value stays visible while reloading, so lists do not flicker.
 */
export function useQuery<T>(load: () => Promise<T>, deps: DependencyList): T | undefined {
  const session = useSession();
  const [value, setValue] = useState<T>();
  const latest = useRef(0);
  const version = session.version;
  useEffect(() => {
    const request = ++latest.current;
    load().then(
      (result) => request === latest.current && setValue(result),
      (error) => console.error(error),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return value;
}
