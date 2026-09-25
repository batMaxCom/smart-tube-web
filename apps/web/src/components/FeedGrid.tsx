import type { FeedItem } from '@stfw/shared';
import { FeedCard } from './FeedCard';

interface Props {
  title?: string;
  items: FeedItem[];
}

export function FeedGrid({ title, items }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      {title ? <h2 className="mb-3 px-1 text-xl font-semibold">{title}</h2> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item) => (
          <FeedCard key={`${item.type}-${item.type === 'video' ? item.video.id : item.type === 'channel' ? item.channel.id : item.playlist.id}`} item={item} />
        ))}
      </div>
    </section>
  );
}