import { useRef } from 'react';
import type { FeedItem } from '@stfw/shared';
import { fetchLive } from '../api';
import { useApp } from '../store';
import { FeedGrid } from '../components/FeedGrid';
import { Empty, ErrorBanner, Loading, SentinalHolder } from '../components/FeedUI';
import { useFeed } from '../useFeed';
import { useInfiniteScroll } from '../useInfiniteScroll';
import { useInitialFocus, useTvNavigation } from '../tvnav';

export function LivePage() {
  const gl = useApp((s) => s.settings.gl);
  const feed = useFeed<FeedItem>(() => fetchLive(gl), 'live', [gl]);

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef, [feed.items]);
  const sentinel = useInfiniteScroll(feed.loadMore, feed.hasMore);

  return (
    <div ref={containerRef} className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4">
      <h1 className="mb-4 flex items-center gap-2 px-1 text-2xl font-semibold">
        Live
        <span className="rounded bg-[#ff0033] px-1.5 py-0.5 text-xs font-semibold uppercase">Live</span>
      </h1>
      <ErrorBanner message={feed.error} />
      {feed.items.length ? <FeedGrid items={feed.items} /> : null}
      {feed.loading ? <Loading /> : null}
      {!feed.loading && !feed.error && feed.items.length === 0 ? (
        <Empty text="Сейчас нет публичных трансляций" />
      ) : null}
      <SentinalHolder ref={sentinel} />
    </div>
  );
}