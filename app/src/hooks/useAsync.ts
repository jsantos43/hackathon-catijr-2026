import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DependencyList } from 'react';
import { errorMessage } from '../services/api';

/** Carrega dados ao montar (e quando `deps` mudam). */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => active && setData(d))
      .catch((e) => active && setError(errorMessage(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, setData, error, loading, reload };
}
