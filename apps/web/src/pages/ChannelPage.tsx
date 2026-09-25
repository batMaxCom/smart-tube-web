import { useRef, useState } from 'react';
import type { ChannelInfo, ChannelTab, ChannelTabInfo, FeedItem } from '@stfw/shared';
import { bestThumb, engage, fetchChannel, formatViews } from '../api';
import { useApp } from '../store';
import { FeedGrid } from '../components/FeedGrid';
import { Empty, ErrorBanner, Loading, SentinalHolder } from '../components/FeedUI';
import { useFeed } from '../useFeed';
import { useInfiniteScroll } from '../useInfiniteScroll';
import { useInitialFocus, useTvNavigation } from '../tvnav';

export function ChannelPage({ id, tab }: { id: string; tab: ChannelTab }) {
  const gl = useApp((s) => s.settings.gl);
  const navigate = useApp((s) => s.navigate);
  const signedIn = useApp((s) => s.account.signedIn);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [tabs, setTabs] = useState<ChannelTabInfo[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [subMsg, setSubMsg] = useState<string | null>(null);

  const feed = useFeed<FeedItem>(
    async () => {
      const r = await fetchChannel(id, tab, gl);
      setChannel(r.channel);
      setTabs(r.tabs);
      setRestricted(!!r.restricted);
      return { items: r.items, continuation: r.continuation };
    },
    'channel',
    [id, tab, gl],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef, [feed.items, tab]);

  const sentinel = useInfiniteScroll(feed.loadMore, feed.hasMore);
  const avatar = bestThumb({ thumbnails: channel?.thumbnails });

  const toggleSubscribe = async () => {
    if (!signedIn) {
      setSubMsg('Войдите в аккаунт: #/account');
      return;
    }
    setSubBusy(true);
    try {
      const r = await engage({ channelId: id, action: subscribed ? 'unsub' : 'sub' });
      if (r.ok) {
        setSubscribed((v) => !v);
        setSubMsg(subscribed ? 'Отписка выполнена' : 'Подписка оформлена');
      } else if (r.reason === 'login_required') {
        setSubMsg('Войдите в аккаунт, чтобы подписываться');
      } else {
        setSubMsg('Не удалось выполнить операцию');
      }
    } catch {
      setSubMsg('Не удалось выполнить операцию');
    } finally {
      setSubBusy(false);
    }
  };

  return (
    <div ref={containerRef} className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4">
      <ErrorBanner message={feed.error} />
      {restricted && !feed.loading ? (
        <div className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
          Канал не отдаёт контент нашему сид-клиенту (для этого нужен вход в аккаунт Google).
        </div>
      ) : null}

      {channel ? (
        <div className="mb-4 rounded-xl bg-[#181818] p-4 sm:p-6">
          {channel.banner?.length && channel.banner.length > 0 ? (
            <div className="pointer-events-none -mx-4 -mt-4 mb-4 flex aspect-[4/1] select-none items-center overflow-hidden rounded-t-xl sm:-mx-6 sm:-mt-6">
              <img
                src={bestThumb({ thumbnails: channel.banner })}
                alt=""
                className="h-full w-full object-cover opacity-40"
                loading="lazy"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full sm:h-24 sm:w-24">
              {avatar ? (
                <img
                  src={avatar}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="h-full w-full bg-[#0f0f0f]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold" data-testid="channel-title">
                {channel.name}
              </h1>
              {channel.handle ? (
                <div className="text-sm text-white/50">{channel.handle}</div>
              ) : null}
              <div className="mt-1 text-sm text-[#aaa]">
                {channel.subscriberCount
                  ? `${formatViews(channel.subscriberCount)} подписчиков`
                  : ''}
                {channel.videoCount ? ` · ${formatViews(channel.videoCount)} видео` : ''}
              </div>
              {channel.description ? (
                <p className="mt-2 line-clamp-2 max-w-3xl text-sm text-white/70">
                  {channel.description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                type="button"
                data-focus
                data-testid="btn-subscribe"
                className={`rounded-full px-5 py-2 text-sm font-medium ${
                  subscribed ? 'bg-white/15 hover:bg-white/25' : 'bg-red-600 hover:bg-red-500'
                } disabled:opacity-50`}
                disabled={subBusy}
                onClick={() => void toggleSubscribe()}
              >
                {subscribed ? 'Вы подписаны' : 'Подписаться'}
              </button>
              {subMsg ? <span className="text-xs text-white/40">{subMsg}</span> : null}
            </div>
          </div>

          {tabs.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-focus
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    t.id === tab ? 'bg-sky-600/80' : 'bg-white/10 hover:bg-white/20'
                  }`}
                  data-testid={`channel-tab-${t.id}`}
                  onClick={() => navigate({ name: 'channel', id, tab: t.id })}
                >
                  {t.title}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {feed.items.length ? <FeedGrid items={feed.items} /> : null}
      {feed.loading ? <Loading /> : null}
      {!feed.loading && !feed.error && feed.items.length === 0 && !restricted ? (
        <Empty text="У канала пока нет публичного контента" />
      ) : null}
      <SentinalHolder ref={sentinel} />
    </div>
  );
}