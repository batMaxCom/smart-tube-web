import type { VideoFormat, VideoCodec, AudioCodec, Thumbnail, ColorInfo } from '@stfw/shared';

/**
 * Строитель DASH-MPD из форматов YouTube (адаптивные потоки + аудио).
 * Использует SegmentBase + byte-range (init_range/index_range) — так работает
 * воспроизведение youtube-DASH без пересборки файла.
 */

const XML = {
  escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },
};

export interface MpdSelection {
  /** предпочитаемый кодек видео: avc | vp9 | av01 */
  codec?: VideoCodec;
  /** верхний предел высоты кадра (пикселей) */
  maxHeight?: number;
  /** тип потоков: muxed (progressive) включён или только adaptive */
  allowProgressive?: boolean;
}

export interface MpdBuildResult {
  mpd: string;
  /** сколько видеопотоков реально попало в манифест */
  videoRepresentations: number;
  audioRepresentations: number;
  totalBitsPerSecond: number;
}

const VIDEO_CODEC_MAP: Record<string, VideoCodec> = {
  avc1: 'avc',
  avc3: 'avc',
  vp09: 'vp9',
  av01: 'av01',
};

export function classifyVideoCodec(codecsString?: string): VideoCodec | null {
  if (!codecsString) return null;
  const key = codecsString.split('.')[0]?.toLowerCase();
  return key ? (VIDEO_CODEC_MAP[key] ?? null) : null;
}

export function classifyAudioCodec(codecsString?: string): AudioCodec {
  if (!codecsString) return 'unknown';
  const lowered = codecsString.toLowerCase();
  if (lowered.includes('opus')) return 'opus';
  if (lowered.includes('vorbis')) return 'vorbis';
  return 'aac';
}

/** Конвертация youtube-потока в наш DTO (без сетевой зависимости). */
export function toFormat(
  f: {
    itag?: number;
    url?: string;
    mime_type?: string;
    codecs?: string;
    bitrate?: number;
    audio_bitrate?: number;
    audio_sample_rate?: string | number;
    audio_channels?: number;
    fps?: number;
    width?: number;
    height?: number;
    content_length?: number;
    init_range?: { start?: number; end?: number };
    index_range?: { start?: number; end?: number };
    color_info?: { primaries?: string; transfer_characteristics?: string };
    quality_label?: string;
  },
  baseUrlPrefix?: string,
): VideoFormat {
  const mime = f.mime_type ?? '';
  const hasVideo = mime.startsWith('video/');
  const hasAudio = mime.startsWith('audio/');
  const codecsString = f.codecs ?? '';
  const colorInfo: ColorInfo | undefined = f.color_info
    ? {
        isHdr:
          (f.color_info.transfer_characteristics ?? '').includes('PQ') ||
          (f.color_info.transfer_characteristics ?? '').includes('HLG'),
        primaries: f.color_info.primaries,
        transferCharacteristics: f.color_info.transfer_characteristics,
      }
    : undefined;

  let rawUrl = f.url;
  if (rawUrl && baseUrlPrefix) rawUrl = `${baseUrlPrefix}${encodeURIComponent(rawUrl)}`;

  return {
    itag: f.itag ?? 0,
    url: rawUrl,
    mimeType: mime,
    codecs: hasVideo
      ? (classifyVideoCodec(codecsString) ?? 'vp9')
      : classifyAudioCodec(codecsString),
    hasVideo,
    hasAudio,
    width: f.width,
    height: f.height,
    fps: f.fps,
    bitrate: f.bitrate,
    audioBitrate: f.audio_bitrate,
    audioSampleRate:
      typeof f.audio_sample_rate === 'string'
        ? parseInt(f.audio_sample_rate, 10)
        : f.audio_sample_rate,
    audioChannels: f.audio_channels,
    colorInfo,
    contentLength: f.content_length,
    initRange: f.init_range ? { start: f.init_range.start!, end: f.init_range.end! } : undefined,
    indexRange: f.index_range
      ? { start: f.index_range.start!, end: f.index_range.end! }
      : undefined,
    isProtected: !rawUrl,
    label: f.quality_label,
    codecsString,
  };
}

/** Выбор «лучшего» аудио-потока по битрейту (opus предпочтителен). */
export function pickAudio(audioFormats: VideoFormat[]): VideoFormat | null {
  if (audioFormats.length === 0) return null;
  const sorted = [...audioFormats].sort((a, b) => {
    const pref = (x: VideoFormat) => (x.codecs === 'opus' ? 2 : x.codecs === 'aac' ? 1 : 0);
    const p = pref(b) - pref(a);
    if (p !== 0) return p;
    return (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0);
  });
  return sorted[0];
}

/** Фильтрация видеопотоков по кодечной группе и пределу разрешения. */
export function selectVideo(formats: VideoFormat[], selection: MpdSelection): VideoFormat[] {
  let result = formats.filter((f) => f.hasVideo);
  if (selection.codec) result = result.filter((f) => f.codecs === selection.codec);
  if (selection.maxHeight) result = result.filter((f) => (f.height ?? 0) <= selection.maxHeight!);
  if (!selection.allowProgressive) result = result.filter((f) => f.hasAudio === false); // только адаптивные
  return result;
}

function durationAttr(seconds?: number): string {
  const sec = seconds && seconds > 0 ? seconds : 1;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const deci = Math.round((sec % 1) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const time =
    h > 0
      ? `${pad(h)}H${pad(m)}M${pad(s)}S`
      : `${pad(m)}M${pad(s)}.${String(deci).padStart(3, '0')}S`;
  return `PT${time}`;
}

function rangeAttr(r?: { start?: number; end?: number }): string | null {
  if (!r || r.start === undefined || r.end === undefined) return null;
  return `${r.start}-${r.end}`;
}

export function buildMpd(params: {
  videoId?: string;
  durationSeconds?: number;
  videoFormats: VideoFormat[];
  audioFormats: VideoFormat[];
  selection?: MpdSelection;
}): MpdBuildResult {
  const selection = params.selection ?? {};
  const video = selectVideo(params.videoFormats, selection);
  const audio = pickAudio(params.audioFormats);
  const representations: string[] = [];
  let videoRepresentations = 0;
  let audioRepresentations = 0;
  let totalBits = 0;

  if (video.length > 0) {
    videoRepresentations = video.length;
    const lines: string[] = [];
    for (const f of video) {
      totalBits += f.bitrate ?? 0;
      const indexRange = rangeAttr(f.indexRange);
      const initRange = rangeAttr(f.initRange);
      const kb = f.bitrate ? Math.max(1, Math.round(f.bitrate / 1000)) : undefined;
      const repl =
        `<Representation id="v${f.itag}" mimeType="${XML.escape(f.mimeType)}" codecs="${XML.escape(
          f.codecsString ?? '',
        )}" bandwidth="${kb ?? 1}" width="${f.width ?? 0}" height="${f.height ?? 0}"${
          f.fps ? ` frameRate="${f.fps}"` : ''
        }${f.colorInfo?.isHdr ? ' sar="1:1"' : ''}>` +
        (indexRange && initRange
          ? `<SegmentBase indexRange="${indexRange}"><Initialization range="${initRange}"/></SegmentBase>`
          : '') +
        `<BaseURL>${XML.escape(f.url ?? '')}</BaseURL>` +
        `</Representation>`;
      lines.push(repl);
    }
    const maxW = Math.max(...video.map((f) => f.width ?? 0));
    const maxH = Math.max(...video.map((f) => f.height ?? 0));
    representations.push(
      `<AdaptationSet mimeType="video/mp4" id="videoset" segmentAlignment="true" maxWidth="${maxW}" maxHeight="${maxH}">${lines.join('')}</AdaptationSet>`,
    );
  }

  if (audio) {
    audioRepresentations = 1;
    totalBits += audio.audioBitrate ?? audio.bitrate ?? 0;
    const indexRange = rangeAttr(audio.indexRange);
    const initRange = rangeAttr(audio.initRange);
    const sampleRate = audio.audioSampleRate ?? audio.audioBitrate ?? '44100';
    const mime = audio.mimeType;
    const repl =
      `<Representation id="a${audio.itag}" mimeType="${XML.escape(mime)}" codecs="${XML.escape(
        audio.codecsString ?? '',
      )}" bandwidth="${Math.max(1, Math.round((audio.audioBitrate ?? audio.bitrate ?? 128000) / 1000))}" audioSamplingRate="${sampleRate}"` +
      ` audioChannelConfiguration="urn:mpeg:dash:23003:3:audio_channel_configuration:2011">` +
      (indexRange && initRange
        ? `<SegmentBase indexRange="${indexRange}"><Initialization range="${initRange}"/></SegmentBase>`
        : '') +
      `<BaseURL>${XML.escape(audio.url ?? '')}</BaseURL>` +
      `</Representation>`;
    representations.push(
      `<AdaptationSet mimeType="audio/mp4" id="audioset" segmentAlignment="true" lang="und">${repl}</AdaptationSet>`,
    );
  }

  const mpd =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013" ` +
    `profiles="urn:mpeg:dash:profile:isoff-main:2011" type="static" ` +
    `mediaPresentationDuration="${durationAttr(params.durationSeconds)}" minBufferTime="PT1.500S"` +
    `>` +
    `<Period>` +
    representations.join('') +
    `</Period>` +
    `</MPD>`;

  return { mpd, videoRepresentations, audioRepresentations, totalBitsPerSecond: totalBits };
}

/** Нормализация иконок youtubei.js → Thumbnail[]. */
export function toThumbnails(
  thumbs?: ArrayLike<{ url?: string; width?: number; height?: number }>,
): Thumbnail[] {
  if (!thumbs) return [];
  return Array.from(thumbs)
    .map((t) => ({ url: t.url ?? '', width: t.width ?? 0, height: t.height ?? 0 }))
    .filter((t) => t.url.length > 0);
}
