import { describe, expect, it } from 'vitest';
import { parseChatItem } from './chat.js';

describe('parseChatItem', () => {
  it('текстовое сообщение', () => {
    const item = parseChatItem({
      type: 'LiveChatTextMessage',
      id: 'c-1',
      message: 'Привет всем!',
      timestamp: 123,
      timestamp_usec: 123000000,
      author: {
        name: 'Олег',
        avatar_thumbnail_url: 'https://i.ytimg.com/a.jpg',
        is_moderator: true,
      },
    });
    expect(item).toEqual({
      id: 'c-1',
      author: {
        name: 'Олег',
        avatarUrl: 'https://i.ytimg.com/a.jpg',
        isModerator: true,
        isVerified: undefined,
        isOwner: undefined,
      },
      text: 'Привет всем!',
      timestamp: 123,
      kind: 'text',
    });
  });

  it('платное сообщение — kind paid, текст из message', () => {
    const item = parseChatItem({
      type: 'LiveChatPaidMessage',
      id: 'c-2',
      message: 'Спасибо за стрим',
      author: { name: 'Спонсор' },
    });
    expect(item?.kind).toBe('paid');
    expect(item?.text).toBe('Спасибо за стрим');
  });

  it('membership — kind membership, текст из header_subtext', () => {
    const item = parseChatItem({
      type: 'LiveChatMembershipItem',
      id: 'c-3',
      header_subtext: 'Новый участник канала',
      author: { name: 'Фанат' },
    });
    expect(item?.kind).toBe('membership');
    expect(item?.text).toBe('Новый участник канала');
  });

  it('неизвестный/неполный узел → null', () => {
    expect(parseChatItem(null)).toBeNull();
    expect(parseChatItem({})).toBeNull();
    expect(parseChatItem({ type: 'SomeOtherAction' })).toBe(null);
  });

  it('флажок владельца из is_creator', () => {
    const item = parseChatItem({
      type: 'LiveChatTextMessage',
      message: 'X',
      author: { name: 'Канал', is_creator: true, thumbnails: [{ url: 'https://x/y.jpg' }] },
    });
    expect(item?.author.isOwner).toBe(true);
    expect(item?.author.avatarUrl).toBe('https://x/y.jpg');
  });
});