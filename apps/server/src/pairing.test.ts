import { describe, expect, it } from 'vitest';
import { MAX_COMMANDS, PairingCenter, generateCode, parseVideoId } from './pairing.js';

describe('pairing', () => {
  it('generateCode: длина и безопасный алфавит', () => {
    const c = generateCode(6);
    expect(c).toHaveLength(6);
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it('create даёт сессии с уникальными кодами', () => {
    const pc = new PairingCenter();
    const a = pc.create('http://phone');
    const b = pc.create('http://phone');
    expect(a.code).not.toBe(b.code);
    expect(a.screenId).toMatch(/^ST[A-HJ-NP-Z2-9]{12}$/);
    expect(a.expiresAt).toBeGreaterThan(Date.now());
  });

  it('send + drain: FIFO и очистка очереди', () => {
    const pc = new PairingCenter();
    const s = pc.create('http://x');
    expect(pc.send(s.code, { kind: 'play', videoId: 'v1', ts: 1 })).toBe(true);
    expect(pc.send(s.code, { kind: 'play', videoId: 'v2', ts: 2 })).toBe(true);
    expect(pc.drain(s.code).map((c) => c.videoId)).toEqual(['v1', 'v2']);
    expect(pc.drain(s.code)).toEqual([]);
  });

  it('send на неизвестный код — false', () => {
    const pc = new PairingCenter();
    expect(pc.send('XXXXXX', { kind: 'play', videoId: 'x', ts: 1 })).toBe(false);
  });

  it('markPaired фиксирует устройство', () => {
    const pc = new PairingCenter();
    const s = pc.create('http://x');
    pc.markPaired(s.code, 'iPhone');
    const u = pc.unique(s.code);
    expect(u?.paired).toBe(true);
    expect(u?.deviceName).toBe('iPhone');
  });

  it('истёкшая сессия вычищается', () => {
    const pc = new PairingCenter(50);
    const s = pc.create('http://x');
    expect(pc.get(s.code)).toBeDefined();
    s.expiresAt = Date.now() - 1;
    expect(pc.get(s.code)).toBeUndefined();
  });

  it('очередь ограничена MAX_COMMANDS', () => {
    const pc = new PairingCenter();
    const s = pc.create('http://x');
    for (let i = 0; i < 60; i += 1) pc.send(s.code, { kind: 'play', videoId: `v${i}`, ts: i });
    const drained = pc.drain(s.code);
    expect(drained).toHaveLength(MAX_COMMANDS);
    expect(drained[0]?.videoId).toBe(`v${60 - MAX_COMMANDS}`);
  });

  it('disconnect удаляет сессию', () => {
    const pc = new PairingCenter();
    const s = pc.create('http://x');
    pc.disconnect(s.code);
    expect(pc.get(s.code)).toBeUndefined();
  });

  it('parseVideoId: ссылки, короткие URL и raw id', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=abc123DEF_9')).toBe('abc123DEF_9');
    expect(parseVideoId('https://youtu.be/xyz987abc12')).toBe('xyz987abc12');
    expect(parseVideoId('https://music.youtube.com/watch?v=QAZwsxEDC43')).toBe('QAZwsxEDC43');
    expect(parseVideoId('abcABC12345')).toBe('abcABC12345');
    expect(parseVideoId('  не видео ')).toBeNull();
    expect(parseVideoId('')).toBeNull();
  });
});