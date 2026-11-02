import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from './api';

export interface Loaded<T> {
  /** The last data that arrived; kept while a refresh is under way, so pages never flash empty. */
  data: T | null;
  /** The last failure in plain words; cleared when a load succeeds. */
  error: string | null;
  /** A load is under way (also for a refresh with data already shown). */
  loading: boolean;
  /** Loads again, keeping the current data meanwhile. */
  reload(): void;
  /** Changes the shown data in place after an action, without a round trip. */
  setData(update: (data: T) => T): void;
}

/**
 * Loads data for a page and keeps it across refreshes. `deps` name what the loader reads,
 * like an effect's; `pollMs` repeats the load while the page is open and the tab visible,
 * as the live view asks (D38).
 */
export function useLoad<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
  pollMs = 0,
): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [attempt, setAttempt] = useState(0);
  // The newest loader, so a poll never calls one made for earlier props.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (document.hidden) return;
      setState((s) => ({ ...s, loading: true }));
      try {
        const data = await loaderRef.current();
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, error: describeError(error), loading: false }));
      }
    };
    void run();
    const timer = pollMs > 0 ? setInterval(() => void run(), pollMs) : undefined;
    return () => {
      cancelled = true;
      if (timer !== undefined) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` stands for what the loader reads
  }, [attempt, pollMs, ...deps]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback(
    (update: (data: T) => T) =>
      setState((s) => (s.data === null ? s : { ...s, data: update(s.data) })),
    [],
  );
  return { ...state, reload, setData };
}

/** Runs one action at a time, keeping its failure in plain words for the control. */
export function useAction(): {
  busy: boolean;
  error: string | null;
  run<T>(action: () => Promise<T>): Promise<T | undefined>;
  clear(): void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (cause) {
      setError(describeError(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  const clear = useCallback(() => setError(null), []);
  return { busy, error, run, clear };
}
