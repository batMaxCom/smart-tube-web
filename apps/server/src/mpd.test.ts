import { describe, expect, it } from 'vitest';
import {
  classifyVideoCodec,
  classifyAudioCodec,
  toFormat,
  selectVideo,
  pickAudio,
  buildMpd,
  toThumbnails,
} from './mpd.js';

const vidAvc = (itag: number, h: number, bitrate = 2_000_000) =>
  toFormat({
    itag,
    mime_type: 'video/mp4',
    codecs: 'avc1.640028',
    bitrate,
    width: 1920,
    height: h,
    fps: 30,
    content_length: 10_000_000,
    init_range: { start: 0, end: 720 },
    index_range: { start: 721, end: 998 },
  });

const vidVp9 = (itag: number, h: number, bitrate = 1_000_000) =>
  toFormat({
    itag,
    mime_type: 'video/mp4',
    codecs: 'vp09.00.10.08',
    bitrate,
    width: 1920,
    height: h,
    fps: 30,
    content_length: 8_000_000,
    init_range: { start: 0, end: 540 },
    index_range: { start: 541, end: 772 },
  });

const audioOpus = toFormat({
  itag: 251,
  mime_type: 'audio/webm',
  codecs: 'opus',
  audio_bitrate: 128_000,
  audio_sample_rate: 48000,
  audio_channels: 2,
  content_length: 4_000_000,
  init_range: { start: 0, end: 600 },
  index_range: { start: 601, end: 900 },
});

const audioAac = toFormat({
  itag: 140,
  mime_type: 'audio/mp4',
  codecs: 'mp4a.40.2',
  audio_bitrate: 96_000,
});

describe('classifyVideoCodec', () => {
  it('maps avc1/vp09/av01 to groups', () => {
    expect(classifyVideoCodec('avc1.640028')).toBe('avc');
    expect(classifyVideoCodec('vp09.00.10.08')).toBe('vp9');
    expect(classifyVideoCodec('av01.0.05M.08')).toBe('av01');
    expect(classifyVideoCodec('')).toBeNull();
  });
});

describe('classifyAudioCodec', () => {
  it('detects opus / vorbis / aac', () => {
    expect(classifyAudioCodec('opus')).toBe('opus');
    expect(classifyAudioCodec('vorbis')).toBe('vorbis');
    expect(classifyAudioCodec('mp4a.40.2')).toBe('aac');
    expect(classifyAudioCodec(undefined)).toBe('unknown');
  });
});

describe('toFormat', () => {
  it('maps mimetype/codecs/ranges and marks missing url as protected', () => {
    const f = vidAvc(137, 1080);
    expect(f.itag).toBe(137);
    expect(f.hasVideo).toBe(true);
    expect(f.hasAudio).toBe(false);
    expect(f.codecs).toBe('avc');
    expect(f.height).toBe(1080);
    expect(f.initRange).toEqual({ start: 0, end: 720 });
    expect(f.indexRange).toEqual({ start: 721, end: 998 });
    expect(f.isProtected).toBe(true);
  });

  it('extracts codecs from MIME and normalizes mime type', () => {
    const f = toFormat({
      itag: 313,
      mime_type: 'video/webm; codecs="vp09.00.50.08"',
      url: 'https://r1.example/video',
    });
    expect(f.mimeType).toBe('video/webm');
    expect(f.codecs).toBe('vp9');
    expect(f.codecsString).toBe('vp09.00.50.08');
    expect(f.isProtected).toBe(false);
  });

  it('parses integer audio sample rate from string', () => {
    const f = toFormat({
      itag: 251,
      mime_type: 'audio/webm',
      codecs: 'opus',
      audio_sample_rate: '48000',
      audio_channels: 2,
    });
    expect(f.audioSampleRate).toBe(48000);
  });
});

describe('selectVideo', () => {
  const list = [vidAvc(137, 1080), vidVp9(248, 1080), vidAvc(299, 720)];

  it('filters by codec', () => {
    const out = selectVideo(list, { codec: 'vp9' });
    expect(out.map((f) => f.itag)).toEqual([248]);
  });

  it('filters by maxHeight', () => {
    const out = selectVideo(list, { maxHeight: 720 });
    expect(out.map((f) => f.itag)).toEqual([299]);
  });

  it('drops muxed streams unless allowProgressive', () => {
    const muxed = toFormat({
      itag: 18,
      mime_type: 'video/mp4',
      codecs: 'avc1.42001E,mp4a.40.2',
    });
    muxed.hasVideo = true;
    muxed.hasAudio = true;
    const out = selectVideo([...list, muxed], {});
    expect(out.every((f) => !f.hasAudio)).toBe(true);
  });
});

describe('pickAudio', () => {
  it('prefers opus then higher bitrate', () => {
    expect(pickAudio([audioAac, audioOpus])?.itag).toBe(251);
    expect(pickAudio([])).toBeNull();
  });
});

describe('buildMpd', () => {
  it('builds static MPD with selected representations', () => {
    const formats = [vidAvc(137, 1080), vidVp9(248, 1080), vidAvc(299, 720)];
    const result = buildMpd({
      videoId: 'abc',
      durationSeconds: 61.5,
      videoFormats: formats,
      audioFormats: [audioOpus],
      selection: { codec: 'avc', maxHeight: 1080 },
    });

    expect(result.videoRepresentations).toBe(2);
    expect(result.audioRepresentations).toBe(1);
    expect(result.totalBitsPerSecond).toBe(2_000_000 + 2_000_000 + 128_000);
    expect(result.mpd).toContain('type="static"');
    expect(result.mpd).toContain('mediaPresentationDuration="PT01M01.500S"');
    expect(result.mpd).toContain(
      '<SegmentBase indexRange="721-998"><Initialization range="0-720"/></SegmentBase>',
    );
    expect(result.mpd).toContain('AdaptationSet');
  });

  it('escapes XML entities in urls/codecs', () => {
    const f = toFormat({
      itag: 18,
      mime_type: 'video/mp4',
      codecs: 'avc1.42001E,mp4a.40.2',
      url: 'https://x.test?a=1&b=2',
    });
    const result = buildMpd({ videoFormats: [f], audioFormats: [] });
    expect(result.mpd).toContain('&amp;');
  });
});

describe('toThumbnails', () => {
  it('normalizes and drops empties', () => {
    const out = toThumbnails([
      { url: 'https://i.ytimg.com/a.jpg', width: 480, height: 270 },
      { url: '', width: 0, height: 0 },
    ]);
    expect(out).toEqual([{ url: 'https://i.ytimg.com/a.jpg', width: 480, height: 270 }]);
    expect(toThumbnails(undefined)).toEqual([]);
  });
});
