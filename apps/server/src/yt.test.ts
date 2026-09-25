import { afterEach, describe, expect, it } from 'vitest';
import { playabilityOf, playerClients, resolveFormatUrls, toVideo, extractPlayer } from './yt.js';

describe('playabilityOf', () => {
  it('maps statuses to our playability', () => {
    expect(playabilityOf('OK')).toBe('ok');
    expect(playabilityOf('LOGIN_REQUIRED')).toBe('login_required');
    expect(playabilityOf('AGE_CHECK_REQUIRED')).toBe('age_restricted');
    expect(playabilityOf('UNPLAYABLE')).toBe('unavailable');
    expect(playabilityOf('SOME_POLICY')).toBe('blocked');
    expect(playabilityOf(undefined)).toBe('ok');
  });
});

describe('toVideo', () => {
  const base = {
    video_id: 'abc123',
    title: 'Test video',
    author: { id: 'UCx', name: 'Channel' },
    thumbnails: [{ url: 'https://i.ytimg.com/1.jpg', width: 480, height: 270 }],
  };

  it('maps a rich item with duration.seconds', () => {
    const v = toVideo({
      ...base,
      duration: { seconds: 127 },
      view_count: { toString: () => '1,234 просмотра' },
    });
    expect(v).toMatchObject({
      id: 'abc123',
      title: 'Test video',
      author: { name: 'Channel' },
      durationSeconds: 127,
      viewCount: 1234,
    });
  });

  it('falls back to length_text and returns 0 when absent', () => {
    expect(toVideo({ ...base, length_text: '2:05' })?.durationSeconds).toBe(125);
    expect(toVideo(base)?.durationSeconds).toBe(0);
  });

  it('null when no id', () => {
    expect(toVideo({ title: 'x' })).toBeNull();
  });
});

describe('extractPlayer', () => {
  const info = {
    basic_info: {
      id: 'x9',
      title: 'Title',
      short_description: 'Desc',
      duration: 90,
      view_count: 42,
      channel: { id: 'UCc', name: 'Chan' },
      thumbnail: [{ url: 'https://t', width: 120, height: 90 }],
      is_live_content: false,
    },
    primary_info: { author: { id: 'UCp', name: 'Primary' } },
    playability_status: { status: 'OK', reason: '' },
    streaming_data: {
      adaptive_formats: [
        {
          itag: 137,
          mime_type: 'video/mp4',
          codecs: 'avc1.640028',
          bitrate: 2_000_000,
          width: 1280,
          height: 720,
        },
        { itag: 251, mime_type: 'audio/webm', codecs: 'opus', audio_bitrate: 128_000 },
      ],
      formats: [{ itag: 18, mime_type: 'video/mp4', codecs: 'avc1.42001E,mp4a.40.2' }],
    },
  };

  it('extracts meta/playability and formats', () => {
    const out = extractPlayer(info);
    expect(out.meta).toMatchObject({
      id: 'x9',
      title: 'Title',
      authorName: 'Primary',
      durationSeconds: 90,
      viewCount: 42,
      playability: 'ok',
    });
    expect(out.meta.thumbnails[0]?.url).toBe('https://t');
    expect(out.formats).toHaveLength(3);
    expect(out.formats[0]).toMatchObject({
      itag: 137,
      hasVideo: true,
      codecs: 'avc',
      isProtected: true,
    });
    expect(out.formats[1]).toMatchObject({ itag: 251, hasAudio: true, codecs: 'opus' });
    expect(out.formats[2]).toMatchObject({ itag: 18, hasVideo: true });
  });

  it('returns empty formats on empty streaming_data', () => {
    const out = extractPlayer({
      basic_info: { id: 'x' },
      playability_status: { status: 'UNPLAYABLE' },
    });
    expect(out.formats).toEqual([]);
    expect(out.meta.playability).toBe('unavailable');
  });
});

describe('resolveFormatUrls', () => {
  const player = {
    decipher: async (url?: string, signatureCipher?: string) =>
      `${signatureCipher ?? url}#deciphered`,
  };

  it('расшифровывает форматы, пришедшие как signatureCipher', async () => {
    const info: {
      streaming_data: {
        adaptive_formats: { itag: number; signature_cipher: string; url?: string }[];
        formats: { itag: number; url: string }[];
      };
    } = {
      streaming_data: {
        adaptive_formats: [{ itag: 137, signature_cipher: 's=abc&url=x' }],
        formats: [{ itag: 18, url: 'https://direct' }],
      },
    };
    const resolved = await resolveFormatUrls(info, player);
    expect(resolved).toBe(1);
    expect(info.streaming_data.adaptive_formats[0].url).toContain('#deciphered');
    // формат с готовым url не трогаем
    expect(info.streaming_data.formats[0].url).toBe('https://direct');
  });

  it('не падает без player и на форматах без ссылки', async () => {
    const info = { streaming_data: { adaptive_formats: [{ itag: 137 }] } };
    expect(await resolveFormatUrls(info, undefined)).toBe(0);
    expect(await resolveFormatUrls(info, player)).toBe(0);
    expect(await resolveFormatUrls({}, player)).toBe(0);
  });

  it('ошибка расшифровки не роняет остальные форматы', async () => {
    const boom = {
      decipher: async (url?: string) => {
        if (!url) throw new Error('no player js');
        return url;
      },
    };
    const info = {
      streaming_data: { adaptive_formats: [{ itag: 137, signature_cipher: 's=a' }] },
    };
    expect(await resolveFormatUrls(info, boom)).toBe(0);
  });
});

describe('playerClients', () => {
  const env = process.env.PLAYER_CLIENTS;

  afterEach(() => {
    if (env === undefined) delete process.env.PLAYER_CLIENTS;
    else process.env.PLAYER_CLIENTS = env;
  });

  it('по умолчанию начинает с клиентов без PO-токена', () => {
    delete process.env.PLAYER_CLIENTS;
    expect(playerClients()[0]).toBe('ANDROID_VR');
    expect(playerClients()).toContain('ANDROID');
  });

  it('берёт порядок из env и чистит мусор', () => {
    process.env.PLAYER_CLIENTS = ' tv , bogus , IOS , tv ';
    expect(playerClients()).toEqual(['TV', 'IOS']);
  });
});
