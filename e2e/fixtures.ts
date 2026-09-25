import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type {
  AuthStatus,
  BackupDocument,
  BrowseResponse,
  ChannelResponse,
  ChatPollResponse,
  CommentsResponse,
  DeviceFlowResponse,
  EngagementResult,
  FavoritesResponse,
  LiveChatMessageItem,
  LiveChatResponse,
  PlaylistResponse,
  PlayerResponse,
  RelatedResponse,
  VideoFormat,
} from '@stfw/shared';

const here = dirname(fileURLToPath(import.meta.url));

export function demoAssetPath(name: 'media.mpd' | 'media.mp4'): string {
  return join(here, '../apps/server/assets/demo', name);
}

export function demoAsset(name: 'media.mpd' | 'media.mp4'): Buffer {
  return readFileSync(demoAssetPath(name));
}

export function videoItem(
  id: string,
  title: string,
  author: { id?: string; name: string } = { id: 'UC' + id, name: `Канал ${id}` },
  extra: Partial<BrowseResponse['sections'][number]['items'][number] extends never ? never : Record<string, unknown>> = {},
) {
  return {
    type: 'video',
    video: {
      id,
      title,
      author,
      durationSeconds: 60,
      viewCount: 100,
      published: 'неделю назад',
      thumbnails: [{ url: `https://i.ytimg.com/${id}.jpg`, width: 480, height: 270 }],
      isLive: false,
      isUpcoming: false,
      ...extra,
    },
  } as const;
}

export const HOME_FIXTURE: BrowseResponse = {
  sections: [
    {
      title: 'Trending',
      items: [
        videoItem('smoketest-1', 'Первый тестовый ролик'),
        videoItem('smoketest-2', 'Второй тестовый ролик'),
      ],
    },
  ],
};

export const SEARCH_FIXTURE = {
  items: [videoItem('smoketest-search', 'Результат поиска')],
};

/** Смешанная лента поиска: видео + канал + плейлист (проверка универсальных карточек). */
export const MIXED_FIXTURE = {
  items: [
    videoItem('mix-video', 'Смешанное видео'),
    {
      type: 'channel',
      channel: {
        id: 'UCmixchannel12345',
        name: 'Канал-результат',
        handle: '@channel-result',
        thumbnails: [{ url: 'https://i.ytimg.com/ch.jpg', width: 176, height: 176 }],
        subscriberCount: 1234567,
        videoCount: 678,
      },
    },
    {
      type: 'playlist',
      playlist: {
        id: 'PLmixplaylist',
        title: 'Плейлист-результат',
        author: { id: 'UCmix1', name: 'Автор плейлиста' },
        thumbnails: [{ url: 'https://i.ytimg.com/pl.jpg', width: 480, height: 270 }],
        videoCount: 12,
      },
    },
  ],
};

export function channelFixture(id: string): ChannelResponse {
  return {
    channel: {
      id,
      name: 'Тестовый канал',
      handle: '@test-channel',
      thumbnails: [{ url: 'https://i.ytimg.com/ch.jpg', width: 176, height: 176 }],
      subscriberCount: 987654,
      videoCount: 321,
      description: 'Описание тестового канала для карточки шапки.',
    },
    tabs: [
      { id: 'videos', title: 'Videos' },
      { id: 'shorts', title: 'Shorts' },
      { id: 'live', title: 'Live' },
    ],
    items: [videoItem('ch-video-1', 'Видео канала 1'), videoItem('ch-video-2', 'Видео канала 2')],
    continuation: undefined,
  };
}

export function playlistFixture(id: string): PlaylistResponse {
  return {
    playlist: {
      id,
      title: 'Тестовый плейлист',
      author: { id: 'UCowner', name: 'Автор' },
      thumbnails: [{ url: 'https://i.ytimg.com/pl.jpg', width: 480, height: 270 }],
      videoCount: 2,
    },
    items: [videoItem('pl-video-1', 'Видео плейлиста 1'), videoItem('pl-video-2', 'Видео плейлиста 2')],
    continuation: undefined,
  };
}

export const NEXT_FIXTURE = {
  items: [videoItem('next-item', 'Следующая порция'), videoItem('next-item-2', 'И ещё'),
  ],
  continuation: undefined,
};

/** Демо-плеер: /player всегда отдаёт демо-режим (не зависит от YouTube в CI). */
export function playerFixture(
  id: string,
  opts: {
    formats?: VideoFormat[];
    playability?: PlayerResponse['playability'];
    demo?: boolean;
    isLive?: boolean;
  } = {},
): PlayerResponse {
  return {
    id,
    title: `Демо-видео ${id}`,
    description: 'Смоук-тест воспроизведения демо-DASH.',
    author: { id: 'UCdemo', name: 'Smoke' },
    durationSeconds: 60,
    thumbnails: [],
    playability: opts.playability ?? 'ok',
    playabilityReason: undefined,
    viewCount: 123,
    likeCount: 45,
    isLive: opts.isLive ?? false,
    formats: opts.formats ?? [],
    manifestPath: '/api/v1/demo/media.mpd',
    demo: opts.demo ?? true,
  };
}

/** Реальные (не-демо) потоки для проверки HQ-диалога. */
export const REAL_FORMATS: VideoFormat[] = [
  {
    itag: 137,
    url: 'https://localhost/unused-137.mp4',
    mimeType: 'video/mp4',
    codecs: 'avc',
    hasVideo: true,
    hasAudio: false,
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 4_900_000,
    label: '1080p',
    codecsString: 'avc1.640028',
  },
  {
    itag: 248,
    url: 'https://localhost/unused-248.webm',
    mimeType: 'video/webm',
    codecs: 'vp9',
    hasVideo: true,
    hasAudio: false,
    width: 1280,
    height: 720,
    fps: 60,
    bitrate: 2_200_000,
    label: '720p60',
    codecsString: 'vp09.00.51.08',
  },
  {
    itag: 18,
    url: 'https://localhost/unused-18.mp4',
    mimeType: 'video/mp4',
    codecs: 'avc',
    hasVideo: true,
    hasAudio: true,
    width: 640,
    height: 360,
    fps: 30,
    bitrate: 800_000,
    label: '360p',
    codecsString: 'avc1.42001e',
  },
];

export function commentItem(
  id: string,
  content: string,
  authorName = `Комментатор ${id}`,
  extra: Partial<CommentsResponse['comments'][number]> = {},
) {
  return {
    id,
    author: { id: `UC-${id}`, name: authorName },
    avatarUrl: `https://i.ytimg.com/${id}.jpg`,
    content,
    publishedTime: '2 дня назад',
    likeCount: '3',
    replyCount: 0,
    isPinned: false,
    ...extra,
  } as const;
}

export function commentsFixture(): CommentsResponse {
  return {
    comments: [
      commentItem('c1', 'Первый комментарий'),
      commentItem('c2', 'Второй комментарий, с ответами', 'Знаток', {
        replyCount: 5,
        likeCount: '42',
        isPinned: true,
      }),
    ],
    continuation: 'c-token-1',
  };
}

export const COMMENTS_NEXT_FIXTURE: CommentsResponse = {
  comments: [commentItem('c3', 'Третий комментарий'), commentItem('c4', 'Четвёртый комментарий')],
  continuation: undefined,
};

export function relatedFixture(): RelatedResponse {
  return {
    upNext: {
      id: 'rec-next',
      title: 'Следующее видео по автоплею',
      author: { id: 'UCrec', name: 'Рекомендатор' },
      durationSeconds: 90,
      thumbnails: [{ url: 'https://i.ytimg.com/rec-next.jpg', width: 480, height: 270 }],
    },
    items: [videoItem('rec-1', 'Похожее видео 1'), videoItem('rec-2', 'Похожее видео 2')],
    continuation: 'r-token-1',
  };
}

export const RELATED_NEXT_FIXTURE = {
  items: [videoItem('rec-3', 'Похожее видео 3')],
  continuation: undefined,
};

export function demoManifestPaths(): { mpd: string; mp4: string } {
  return {
    mpd: '/api/v1/demo/media.mpd',
    mp4: '/api/v1/demo/media.mp4',
  };
}

/* ================== Фаза 3: аккаунт / чат / бэкап ================== */

export function authGuest(): AuthStatus {
  return { signedIn: false, pending: null };
}

export function authSignedIn(name = 'Мой канал', id = 'UCmine123'): AuthStatus {
  return {
    signedIn: true,
    channel: { id, name, avatarUrl: 'https://i.ytimg.com/me.jpg' },
    pending: null,
  };
}

export function devicePending(code = 'ABCDEF'): DeviceFlowResponse {
  return {
    status: 'pending',
    signedIn: false,
    pending: {
      userCode: code,
      verificationUrl: 'https://www.youtube.com/activate',
      interval: 5,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    },
  };
}

export function chatMessage(
  id: string,
  name: string,
  text: string,
  extra: Partial<LiveChatMessageItem> = {},
): LiveChatMessageItem {
  return {
    id,
    author: { name },
    text,
    timestamp: Math.floor(Date.now() / 1000),
    kind: 'text',
    ...extra,
  };
}

export function chatStarted(
  videoId: string,
  messages: LiveChatMessageItem[],
  after = messages.length,
): LiveChatResponse {
  return { available: true, videoId, isReplay: false, after, messages };
}

export function chatPollFixture(messages: LiveChatMessageItem[], after = messages.length): ChatPollResponse {
  return { messages, after };
}

export const ENGAGE_OK: EngagementResult = { ok: true };
export const ENGAGE_LOGIN_REQUIRED: EngagementResult = { ok: false, reason: 'login_required' };

export function favoritesFixture(items: { id: string; title: string; addedAt: number; authorName?: string }[]): FavoritesResponse {
  return { items };
}

export function backupDoc(data: Record<string, unknown>): BackupDocument {
  return { kind: 'stfw-backup', version: 1, savedAt: Date.now(), data };
}

/* ================== общие моки плеера (Фаза 2, переиспользуются в Фазе 4) ================== */

const DEMO_MPD = demoAsset('media.mpd').toString('utf8');
const DEMO_MPD_ABS = DEMO_MPD.replace('>media.mp4<', '>/api/v1/demo/media.mp4<');
const DEMO_MP4 = demoAsset('media.mp4');

/** Полный набор моков под страницу плеера: 404 catch-all + демо-DASH + player/related/comments. */
export async function mockPlayerApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: '{"error":"no mock"}',
    });
  });
  await page.route('**/api/v1/manifest**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/dash+xml', body: DEMO_MPD_ABS });
  });
  await page.route('**/api/v1/player**', async (route, request) => {
    const id = new URL(request.url()).searchParams.get('id') ?? 'unknown';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(playerFixture(id)),
    });
  });
  await page.route('**/api/v1/related**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(relatedFixture()),
    });
  });
  await page.route('**/api/v1/comments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(commentsFixture()),
    });
  });
  await page.route('**/api/v1/next?src=comments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(COMMENTS_NEXT_FIXTURE),
    });
  });
  await page.route('**/api/v1/next?src=related**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RELATED_NEXT_FIXTURE),
    });
  });
  await page.route('**/api/v1/demo/media.mpd', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/dash+xml', body: DEMO_MPD });
  });
  await page.route('**/api/v1/demo/media.mp4', async (route, request) => {
    const range = request.headers()['range'];
    if (range) {
      const [startStr, endStr] = range.replace(/^bytes=/, '').split('-');
      const start = parseInt(startStr ?? '0', 10);
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024 - 1, DEMO_MP4.length - 1);
      await route.fulfill({
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${DEMO_MP4.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
        },
        body: DEMO_MP4.subarray(start, end + 1),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'video/mp4', body: DEMO_MP4 });
  });
}

export async function waitVideoPlaying(page: Page, ms = 15_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const st = await page.evaluate(() => {
          const v = document.querySelector('video');
          return v ? { ready: v.readyState, time: v.currentTime } : null;
        });
        return (st && st.ready >= 2 && st.time > 0) || null;
      },
      { timeout: ms },
    )
    .toBeTruthy();
}