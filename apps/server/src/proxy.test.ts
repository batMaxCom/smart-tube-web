import { beforeEach, describe, expect, it } from 'vitest';
import { clearProxyRegistry, localizeUrls, registerProxyUrl, resolveProxyToken } from './proxy.js';

beforeEach(() => clearProxyRegistry());

describe('proxy registry', () => {
  it('stores media URLs behind opaque local paths', () => {
    const target = 'https://rr3---sn-example.googlevideo.com/videoplayback?expire=1';
    const local = registerProxyUrl(target, 'media');
    expect(local).toMatch(/^\/api\/v1\/stream\/[0-9a-f-]+$/);
    expect(local).not.toContain('googlevideo.com');
    const token = local?.split('/').pop();
    expect(resolveProxyToken(token ?? '', 'media')).toBe(target);
    expect(resolveProxyToken(token ?? '', 'asset')).toBeUndefined();
    expect(registerProxyUrl(target, 'media')).toBe(local);
  });

  it('allows image hosts and rejects unsafe targets', () => {
    expect(registerProxyUrl('https://i.ytimg.com/vi/id.jpg', 'asset')).toMatch(
      /^\/api\/v1\/asset\//,
    );
    expect(registerProxyUrl('https://youtube.com@127.0.0.1/private', 'media')).toBeUndefined();
    expect(registerProxyUrl('https://evil.example/video', 'media')).toBeUndefined();
    expect(registerProxyUrl('http://rr3.googlevideo.com/video', 'media')).toBeUndefined();
  });

  it('localizes media and image URLs while preserving OAuth links', () => {
    const value = localizeUrls({
      formats: [{ url: 'https://rr3---sn-example.googlevideo.com/video' }],
      thumbnails: [{ url: 'https://i.ytimg.com/vi/id.jpg' }],
      avatarUrl: 'https://yt3.ggpht.com/avatar.jpg',
      verificationUrl: 'https://www.youtube.com/activate',
    }) as Record<string, unknown>;
    const formats = value.formats as Array<{ url: string }>;
    const thumbnails = value.thumbnails as Array<{ url: string }>;
    expect(formats[0].url).toMatch(/^\/api\/v1\/stream\//);
    expect(thumbnails[0].url).toMatch(/^\/api\/v1\/asset\//);
    expect(value.avatarUrl).toMatch(/^\/api\/v1\/asset\//);
    expect(value.verificationUrl).toBe('https://www.youtube.com/activate');
  });
});
