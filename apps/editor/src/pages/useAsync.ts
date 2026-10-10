import { useCallback, useEffect, useState } from "react";

/** Loads data on mount and on reload(); keeps the last value while reloading. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: callers pass the dependencies
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    run().then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (error) =>
        !cancelled &&
        setState({
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false,
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [run]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}
