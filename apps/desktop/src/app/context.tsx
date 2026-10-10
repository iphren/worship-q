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
import type { OutputController } from './output';

export type Page = 'songs' | 'calendar' | 'present' | 'settings';

export interface AppServices {
  session: Session;
  output: OutputController;
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
