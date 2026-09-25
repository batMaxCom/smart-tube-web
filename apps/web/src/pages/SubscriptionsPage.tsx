import { useRef } from 'react';
import type { FeedItem } from '@stfw/shared';
import { fetchSubscriptions } from '../api';
import { useApp } from '../store';
import { FeedGrid } from '../components/FeedGrid';
import { Empty, ErrorBanner, Loading, SentinalHolder } from '../components/FeedUI';
import { useFeed } from '../useFeed';
import { useInfiniteScroll } from '../useInfiniteScroll';
import { useInitialFocus, useTvNavigation } from '../tvnav';

export function SubscriptionsPage() {
  const gl = useApp((s) => s.settings.gl);
  const feed = useFeed<FeedItem>(() => fetchSubscriptions(gl), 'subscriptions', [gl]);

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef, [feed.items]);
  const sentinel = useInfiniteScroll(feed.loadMore, feed.hasMore);

  return (
    <div ref={containerRef} className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4">
      <h1 className="mb-4 px-1 text-2xl font-semibold">Подписки</h1>
      {!feed.loading && feed.items.length === 0 && !feed.error ? (
        <div className="mb-4 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          Вы не вошли в аккаунт — лента подписок станет доступна после добавления входа (Фаза 3).
        </div>
      ) : null}
      <ErrorBanner message={feed.error} />
      {feed.items.length ? <FeedGrid items={feed.items} /> : null}
      {feed.loading ? <Loading /> : null}
      {!feed.loading && !feed.error && feed.items.length === 0 ? (
        <Empty text="В гостевом режиме подписки не отображаются" />
      ) : null}
      <SentinalHolder ref={sentinel} />
    </div>
  );
}