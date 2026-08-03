import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs an async loader and exposes {data, error, loading, refreshing, reload}.
 *
 * Results from a superseded run are ignored, so a fast refresh after a slow
 * initial load cannot overwrite newer data with older data.
 */
export function useAsync(loader, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [refreshing, setRefreshing] = useState(false);
  const runId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async ({ refresh = false } = {}) => {
      const id = ++runId.current;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      try {
        const result = await loader();
        if (mounted.current && id === runId.current) {
          setData(result);
          setError(null);
        }
        return result;
      } catch (err) {
        if (mounted.current && id === runId.current) setError(err);
        return null;
      } finally {
        if (mounted.current && id === runId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    if (immediate) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, immediate]);

  return {
    data,
    error,
    loading,
    refreshing,
    reload: run,
    refresh: useCallback(() => run({ refresh: true }), [run]),
    setData,
  };
}

export default useAsync;
