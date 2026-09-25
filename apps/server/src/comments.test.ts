import { describe, expect, it } from 'vitest';
import { pickUpNext, toComments } from './yt.js';
import type { FeedItem, Video } from '@stfw/shared';

const video = (id: string): Video => ({
  id,
  title: `Видео ${id}`,
  author: { id: 'UC1', name: 'Автор' },
  durationSeconds: 60,
  thumbnails: [],
});

describe('toComments', () => {
  it('пустая порция → [], без комментария — пропуск', () => {
    expect(toComments(undefined)).toEqual([]);
    expect(toComments({ contents: [{}] })).toEqual([]);
    expect(toComments({ contents: [{ comment: null }] })).toEqual([]);
  });

  it('маппит полный комментарий', () => {
    const node = {
      contents: [
        {
          comment: {
            comment_id: 'c-1',
            author: {
              name: 'Олег',
              thumbnails: [{ url: 'https://i.ytimg.com/av.jpg' }],
              endpoint: { payload: { browseId: 'UCauthor' } },
            },
            content: 'Отличное видео!',
            published_time: '2 дня назад',
            like_count: '12K',
            reply_count: '3',
            is_pinned: true,
          },
          has_replies: true,
        },
      ],
    };
    expect(toComments(node)).toEqual([
      {
        id: 'c-1',
        author: { id: 'UCauthor', name: 'Олег' },
        avatarUrl: 'https://i.ytimg.com/av.jpg',
        content: 'Отличное видео!',
        publishedTime: '2 дня назад',
        likeCount: '12K',
        replyCount: 3,
        isPinned: true,
        hasReplies: true,
      },
    ]);
  });

  it('нет автора → Аноним, нет id → контент всё равно вставляется', () => {
    const node = {
      contents: [{ comment: { content: 'без шапки', like_count: '1' } }],
    };
    expect(toComments(node)[0]).toMatchObject({
      author: { name: 'Аноним', id: undefined },
      content: 'без шапки',
      likeCount: '1',
    });
  });

  it('reply_count огромный → число, reply_count с буквами → undefined', () => {
    const a = toComments({ contents: [{ comment: { content: 'x', reply_count: '99999' } }] });
    expect(a[0].replyCount).toBe(99999);
    const b = toComments({ contents: [{ comment: { content: 'x', reply_count: 'нет данных' } }] });
    expect(b[0].replyCount).toBeUndefined();
  });
});

describe('pickUpNext', () => {
  const items: FeedItem[] = [
    { type: 'video', video: video('aaa111') },
    { type: 'playlist', playlist: { id: 'PLx', title: 'P', thumbnails: [] } },
  ];

  it('есть autoplay id → берём его', () => {
    const up = pickUpNext(items, 'aaa111');
    expect(up?.id).toBe('aaa111');
    expect(up?.title).toBe('Видео aaa111');
  });

  it('autoplay id не найден в ленте → заглушка Далее', () => {
    const up = pickUpNext(items, 'zzz999');
    expect(up).toMatchObject({ id: 'zzz999', title: 'Далее' });
  });

  it('нет autoplay → первое видео из ленты', () => {
    const up = pickUpNext(items);
    expect(up?.id).toBe('aaa111');
  });

  it('первый элемент — плейлист → undefined', () => {
    const up = pickUpNext([{ type: 'playlist', playlist: { id: 'PLx', title: 'P', thumbnails: [] } }]);
    expect(up).toBeUndefined();
  });
});