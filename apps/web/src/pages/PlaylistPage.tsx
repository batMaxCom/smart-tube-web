import { useRef, useState } from 'react';
import type { FeedItem, PlaylistInfo } from '@stfw/shared';
import { bestThumb, fetchPlaylist, formatViews } from '../api';
import { useApp } from '../store';
import { FeedGrid } from '../components/FeedGrid';
import { Empty, ErrorBanner, Loading, SentinalHolder } from '../components/FeedUI';
import { useFeed } from '../useFeed';
import { useInfiniteScroll } from '../useInfiniteScroll';
import { useInitialFocus, useTvNavigation } from '../tvnav';

export function PlaylistPage({ id }: { id: string }) {
  const gl = useApp((s) => s.settings.gl);
  const navigate = useApp((s) => s.navigate);
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);

  const feed = useFeed<FeedItem>(
    async () => {
      const r = await fetchPlaylist(id, gl);
      setPlaylist(r.playlist);
      return { items: r.items, continuation: r.continuation };
    },
    'playlist',
    [id, gl],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef, [feed.items]);

  const sentinel = useInfiniteScroll(feed.loadMore, feed.hasMore);
  const pthumb = bestThumb({ thumbnails: playlist?.thumbnails });

  return (
    <div ref={containerRef} className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4">
      <ErrorBanner message={feed.error} />

      {playlist ? (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl bg-[#181818] p-4">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg">
            {pthumb ? (
              <img src={pthumb} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="h-full w-full bg-[#0f0f0f]" />
            )}
            {playlist.videoCount ? (
              <span className="absolute right-0 bottom-0 left-0 bg-black/70 px-1 py-0.5 text-center text-[11px] text-white/90">
                {formatViews(playlist.videoCount)} видео
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold" data-testid="playlist-title">
              {playlist.title}
            </h1>
            {playlist.author?.name ? (
              <button
                type="button"
                data-focus
                className="mt-1 text-sm text-[#aaa] hover:text-white"
                onClick={() =>
                  playlist.author?.id &&
                  navigate({ name: 'channel', id: playlist.author.id, tab: 'videos' })
                }
              >
                {playlist.author.name}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {feed.items.length ? <FeedGrid items={feed.items} /> : null}
      {feed.loading ? <Loading /> : null}
      {!feed.loading && !feed.error && feed.items.length === 0 ? (
        <Empty text="Плейлист пуст или недоступен" />
      ) : null}
      <SentinalHolder ref={sentinel} />
    </div>
  );
}