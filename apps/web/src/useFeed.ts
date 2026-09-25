import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedSource } from '@stfw/shared';
import { fetchNext } from './api';

interface PagedResult {
  items: unknown[];
  continuation?: string;
}

/**
 * Лента с продолжением (`/api/v1/next`) для бесконечного скролла.
 * `deps` — перезагрузка при смене страницы/вкладки.
 */
export function useFeed<T>(
  fetchFirst: () => Promise<PagedResult>,
  src: FeedSource,
  deps: unknown[] = [],
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contRef = useRef<string | undefined>(undefined);
  const genRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchFirst();
      if (gen !== genRef.current) return;
      setItems((r.items as T[]) ?? []);
      contRef.current = r.continuation;
    } catch (e) {
      if (gen !== genRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      contRef.current = undefined;
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (busy || !contRef.current) return;
    const gen = genRef.current;
    const token = contRef.current;
    setBusy(true);
    try {
      const r = await fetchNext(src, token);
      if (gen !== genRef.current) return;
      setItems((prev) => [...prev, ...((r.items as T[]) ?? [])]);
      contRef.current = r.continuation;
    } catch {
      if (gen === genRef.current) contRef.current = undefined; // останавливаем цикл
    } finally {
      if (gen === genRef.current) setBusy(false);
    }
  }, [busy, src]);

  return {
    items,
    loading,
    busy,
    error,
    reload: load,
    loadMore,
    hasMore: !loading && !busy && !!contRef.current && error === null,
  };
}