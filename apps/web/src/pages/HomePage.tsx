import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowseResponse, FeedRow } from '@stfw/shared';
import { fetchBrowse, fetchNext } from '../api';
import { useApp } from '../store';
import { FeedGrid } from '../components/FeedGrid';
import { ErrorBanner, Loading, SentinalHolder } from '../components/FeedUI';
import { useInfiniteScroll } from '../useInfiniteScroll';
import { useInitialFocus, useTvNavigation } from '../tvnav';

export function HomePage() {
  const gl = useApp((s) => s.settings.gl);
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const genRef = useRef(0);

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef, [rows]);

  const reload = useCallback(() => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    fetchBrowse(gl)
      .then((d: BrowseResponse) => {
        if (gen !== genRef.current) return;
        setRows(d.sections);
        contRef.current = d.continuation;
      })
      .catch((e: Error) => gen === genRef.current && setError(e.message))
      .finally(() => gen === genRef.current && setLoading(false));
  }, [gl]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onNeeded = useCallback(() => {
    const gen = genRef.current;
    if (busyRef.current || !contRef.current) return;
    const token = contRef.current;
    busyRef.current = true;
    setMore(true);
    fetchNext('browse', token)
      .then((r) => {
        if (gen !== genRef.current) return;
        setRows((prev) => [...prev, { items: r.items }]);
        contRef.current = r.continuation;
      })
      .catch(() => {
        if (gen === genRef.current) contRef.current = undefined;
      })
      .finally(() => {
        busyRef.current = false;
        if (gen === genRef.current) setMore(false);
      });
  }, []);

  const sentinel = useInfiniteScroll(onNeeded, !!contRef.current && rows.length > 0);

  return (
    <div ref={containerRef} className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4">
      <ErrorBanner message={error} />
      {rows.map((row, i) => (
        <FeedGrid key={`${row.title ?? 'row'}-${i}`} title={row.title} items={row.items} />
      ))}
      {loading || more ? <Loading /> : null}
      <SentinalHolder ref={sentinel} />
    </div>
  );
}