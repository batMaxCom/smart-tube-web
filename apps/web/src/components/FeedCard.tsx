import type { FeedItem } from '@stfw/shared';
import { bestThumb, formatDuration, formatViews } from '../api';
import { useApp } from '../store';

function WithThumb({
  thumb,
  children,
  ratio = 'aspect-video',
}: {
  thumb?: string;
  children?: React.ReactNode;
  ratio?: string;
}) {
  return (
    <div className={`relative w-full overflow-hidden rounded-lg ${ratio}`}>
      {thumb ? (
        <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="h-full w-full bg-[#0f0f0f]" />
      )}
      {children}
    </div>
  );
}

function VideoFace({ item }: { item: Extract<FeedItem, { type: 'video' }> }) {
  const { video } = item;
  return (
    <div className="h-full w-full">
      <WithThumb thumb={bestThumb(video)}>
        {video.durationSeconds > 0 && (
          <span className="absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium">
            {formatDuration(video.durationSeconds)}
          </span>
        )}
        {video.isLive && (
          <span className="absolute right-2 bottom-2 rounded bg-[#ff0033] px-1.5 py-0.5 text-xs font-semibold uppercase">
            Live
          </span>
        )}
      </WithThumb>
      <div className="px-1 pt-2">
        <div className="line-clamp-2 text-sm leading-snug" title={video.title}>
          {video.title}
        </div>
        <div className="mt-1.5 text-xs text-[#aaa]">
          {video.author?.name ? <span className="truncate">{video.author.name}</span> : null}
          {video.viewCount ? (
            <span> · {formatViews(video.viewCount)} просмотров</span>
          ) : (
            video.published && <span>{video.published}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelFace({ item }: { item: Extract<FeedItem, { type: 'channel' }> }) {
  const { channel } = item;
  const avatar = bestThumb({ thumbnails: channel.thumbnails });
  return (
    <div className="flex h-full w-full flex-col items-center bg-[#181818] p-4 text-center">
      <div className="relative h-[8rem] w-[8rem] overflow-hidden rounded-full">
        {avatar ? (
          <img src={avatar} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="h-full w-full bg-[#0f0f0f]" />
        )}
      </div>
      <div className="mt-3 line-clamp-2 text-sm font-medium" title={channel.name}>
        {channel.name}
      </div>
      <div className="mt-1 text-xs text-[#aaa]">
        {channel.subscriberCount
          ? `${formatViews(channel.subscriberCount)} подписчиков`
          : channel.videoCount
            ? `${channel.videoCount} видео`
            : 'Подписчики'}
      </div>
      <span className="mt-3 rounded-full bg-white/10 px-4 py-1.5 text-xs">Подписаться</span>
    </div>
  );
}

function PlaylistFace({ item }: { item: Extract<FeedItem, { type: 'playlist' }> }) {
  const { playlist } = item;
  return (
    <div className="h-full w-full">
      <div className="relative">
        <WithThumb thumb={bestThumb({ thumbnails: playlist.thumbnails })} />
        <span className="absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/90 to-transparent px-2 pt-5 pb-1.5 text-right text-xs text-white/90">
          {playlist.videoCount ? `${formatViews(playlist.videoCount)} видео` : 'Плейлист'}
        </span>
      </div>
      <div className="px-1 pt-2">
        <div className="line-clamp-2 text-sm leading-snug" title={playlist.title}>
          {playlist.title}
        </div>
        <div className="mt-1.5 truncate text-xs text-[#aaa]">{playlist.author?.name ?? ''}</div>
      </div>
    </div>
  );
}

/** Универсальная карточка ленты: видео / канал / плейлист. */
export function FeedCard({ item }: { item: FeedItem }) {
  const navigate = useApp((s) => s.navigate);

  if (item.type === 'channel') {
    return (
      <button
        type="button"
        data-focus
        data-testid={`card-channel-${item.channel.id}`}
        className="group h-full cursor-pointer overflow-hidden rounded-xl bg-[#181818] p-0 text-left outline-none transition focus:-outline-offset-2 focus:outline-2 focus:outline-sky-400"
        onClick={() => navigate({ name: 'channel', id: item.channel.id, tab: 'videos' })}
      >
        <ChannelFace item={item} />
      </button>
    );
  }

  if (item.type === 'playlist') {
    return (
      <button
        type="button"
        data-focus
        data-testid={`card-playlist-${item.playlist.id}`}
        className="group h-full cursor-pointer rounded-xl bg-[#181818] p-2 text-left outline-none transition focus:-outline-offset-2 focus:outline-2 focus:outline-sky-400"
        onClick={() => navigate({ name: 'playlist', id: item.playlist.id })}
      >
        <PlaylistFace item={item} />
      </button>
    );
  }

  return (
    <button
      type="button"
      data-focus
      data-testid={`card-${item.video.id}`}
      className="group h-full cursor-pointer rounded-xl bg-[#181818] p-2 text-left outline-none transition focus:-outline-offset-2 focus:outline-2 focus:outline-sky-400"
      onClick={() => navigate({ name: 'watch', id: item.video.id })}
    >
      <VideoFace item={item} />
    </button>
  );
}