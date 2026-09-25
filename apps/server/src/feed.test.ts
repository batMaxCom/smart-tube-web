import { describe, expect, it } from 'vitest';
import {
  collectItems,
  collectRows,
  nextOfFeed,
  parseHumanCount,
  toChannel,
  toPlaylist,
  toVideo,
} from './yt.js';

const video = (id: string) => ({
  type: 'Video',
  video_id: id,
  title: `v${id}`,
  duration: { seconds: 10 },
});

describe('toChannel', () => {
  it('извлекает канал из GridChannel (id/имя/подписчики)', () => {
    const c = toChannel({
      type: 'GridChannel',
      id: 'UCabc1234567890',
      author: { id: 'UCabc1234567890', name: 'Канал Тест' },
      thumbnails: [{ url: 'https://t/avatar.jpg', width: 88, height: 88 }],
      subscribers: '2.3M subscribers',
      video_count: '1.5K videos',
    });
    expect(c).toMatchObject({ id: 'UCabc1234567890', name: 'Канал Тест' });
    expect(c?.subscriberCount).toBeCloseTo(2.3e6, 0);
    expect(c?.videoCount).toBeCloseTo(1500, 0);
    expect(c?.thumbnails[0].url).toBe('https://t/avatar.jpg');
  });

  it('канал-результат поиска (класс Channel) тоже разбирается', () => {
    const c = toChannel({
      type: 'Channel',
      id: 'UCx',
      author: { id: 'UCx', name: 'Поиск Канал' },
      subscribers: '12K',
    });
    expect(c?.name).toBe('Поиск Канал');
    expect(c?.subscriberCount).toBe(12000);
  });

  it('без id возвращает null', () => {
    expect(toChannel({ type: 'Channel', name: 'x' })).toBeNull();
  });
});

describe('toPlaylist', () => {
  it('извлекает плейлист из GridPlaylist', () => {
    const p = toPlaylist({
      type: 'GridPlaylist',
      id: 'PLxxxx',
      title: 'Мой плейлист',
      video_count: '42 videos',
      thumbnails: [{ url: 'https://t/p.jpg', width: 480, height: 270 }],
    });
    expect(p).toMatchObject({ id: 'PLxxxx', title: 'Мой плейлист', videoCount: 42 });
  });

  it('плейлист с автором-классом Author', () => {
    const p = toPlaylist({
      type: 'Playlist',
      id: 'RDyyy',
      title: 'Mixed',
      author: { id: 'UCz', name: 'Автор' },
    });
    expect(p?.author).toEqual({ id: 'UCz', name: 'Автор' });
  });

  it('без id возвращает null', () => {
    expect(toPlaylist({ type: 'Playlist', title: 'x' })).toBeNull();
  });
});

describe('toVideo', () => {
  it('видео с duration.seconds и length_text', () => {
    const v = toVideo({
      type: 'Video',
      video_id: 'vid1',
      title: 'Title',
      duration: { seconds: 125 },
      view_count: '1234',
      is_live: false,
    });
    expect(v).toMatchObject({ id: 'vid1', durationSeconds: 125, viewCount: 1234 });
  });
});

describe('collectItems', () => {
  it('собирает видео по порядку, игнорируя обёртки', () => {
    const items = collectItems({
      contents: [
        { type: 'RichItem', content: video('a') },
        { type: 'RichItem', content: video('b') },
      ],
    });
    expect(items.map((i) => i.type)).toEqual(['video', 'video']);
    expect((items[0] as { video: { id: string } }).video.id).toBe('a');
  });

  it('миксует видео/каналы/плейлисты одной лентой', () => {
    const items = collectItems({
      items: [
        video('a'),
        { type: 'Channel', id: 'UCc', author: { id: 'UCc', name: 'C' }, subscribers: '1K' },
        { type: 'GridPlaylist', id: 'PLp', title: 'P', video_count: '3' },
      ],
    });
    expect(items.map((i) => i.type)).toEqual(['video', 'channel', 'playlist']);
    expect(items[1]).toMatchObject({ channel: { id: 'UCc' } });
    expect(items[2]).toMatchObject({ playlist: { id: 'PLp' } });
  });

  it('не ходит внутрь классифицированного узла (вложенный channel видео не становится карточкой)', () => {
    const items = collectItems([
      video('a') /* у видео нет списковых ключей — никаких ложных каналов */,
    ]);
    expect(items).toHaveLength(1);
  });

  it('дедуплицирует повторные вхождения по id+тип', () => {
    const items = collectItems({
      items: [video('a'), video('a'), { contents: [video('a')] }],
    });
    expect(items).toHaveLength(1);
  });

  it('корневой Feed-объект с getters arrays', () => {
    const items = collectItems({
      videos: [video('x'), video('y')],
      channels: [],
      playlists: [],
    } as never);
    expect(items).toHaveLength(2);
  });
});

describe('collectRows', () => {
  it('строит полки с заголовками', () => {
    const rows = collectRows({
      contents: [
        {
          type: 'RichShelf',
          title: 'Trending',
          contents: [{ type: 'RichItem', content: video('a') }],
        },
        {
          type: 'RichShelf',
          title: 'Music',
          contents: [{ type: 'RichItem', content: video('b') }],
        },
      ],
    });
    expect(rows.map((r) => r.title)).toEqual(['Trending', 'Music']);
    expect(rows[0].items).toHaveLength(1);
  });

  it('без содержимого в полках возвращает пусто', () => {
    expect(collectRows({ contents: [] })).toEqual([]);
  });
});

describe('parseHumanCount', () => {
  it('парсит суффиксы K/M/B и локали', () => {
    expect(parseHumanCount('2.3M subscribers')).toBeCloseTo(2.3e6, 0);
    expect(parseHumanCount('1,5 млн')).toBeCloseTo(1.5e6, 0);
    expect(parseHumanCount('450 videos')).toBe(450);
    expect(parseHumanCount('')).toBeUndefined();
  });
});

describe('nextOfFeed', () => {
  it('берёт следующую порцию и сохраняет продолжение', async () => {
    const feedA = {
      has_continuation: true,
      getContinuation: async () => ({
        has_continuation: false,
        videos: [{ type: 'Video', video_id: 'n1', title: 'next' }],
      }),
    };
    const entry = { src: 'search' as const, feed: feedA as never };
    const res = await nextOfFeed(entry);
    expect(res?.items).toHaveLength(1);
    expect(res?.continuation).toBeUndefined();
  });

  it('без получения продолжения возвращает null', async () => {
    const res = await nextOfFeed({ src: 'search' as const, feed: {} as never });
    expect(res).toBeNull();
  });
});