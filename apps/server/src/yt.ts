import { randomBytes } from 'node:crypto';
import Innertube from 'youtubei.js';
import { loadTokens } from './creds.js';
import type {
  ChannelInfo,
  ChannelResponse,
  ChannelTab,
  CommentInfo,
  CommentsResponse,
  FeedItem,
  FeedRow,
  FeedSource,
  NextResponse,
  PlaylistInfo,
  PlaylistResponse,
  RelatedResponse,
  SearchResponse,
  Video,
  VideoFormat,
} from '@stfw/shared';
import { toFormat, toThumbnails } from './mpd.js';

/** Структурный тип потока из youtubei.js (не импортируем классы, чтобы не цепляться за их версию). */
type YtFormat = {
  itag?: number;
  url?: string;
  mime_type?: string;
  codecs?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  audio_bitrate?: number;
  audio_sample_rate?: number | string;
  audio_channels?: number;
  init_range?: { start?: number; end?: number };
  index_range?: { start?: number; end?: number };
  content_length?: number;
  quality_label?: string;
  color_info?: {
    primaries?: string;
    transfer_characteristics?: string;
    matrix_coefficients?: string;
  };
  has_video?: boolean;
  has_audio?: boolean;
  drm_families?: string[];
  audio_sample_rate_string?: string;
  /** Зашифрованная ссылка: YouTube отдаёт её вместо url, если нужен n-трансформ. */
  signature_cipher?: string;
  cipher?: string;
  /** Метод youtubei.js: превращает signature_cipher в готовый url. */
  decipher?: (player?: unknown) => Promise<string>;
};

/** Минимальный контракт JS-player'а, который нам нужен для расшифровки. */
type DecipherPlayer = {
  decipher: (
    url?: string,
    signatureCipher?: string,
    cipher?: string,
    cache?: Map<string, string>,
  ) => Promise<string>;
};

/** Лениво-созданная сессия (как у видео-инфо): объект с getContinuation. */
interface FeedLike {
  has_continuation?: boolean;
  getContinuation?: () => Promise<FeedLike>;
}

const RETRIES = 2;

/** Player-клиенты InnerTube, которые понимает youtubei.js. */
export const KNOWN_PLAYER_CLIENTS = [
  'ANDROID_VR',
  'ANDROID',
  'IOS',
  'TV',
  'TV_SIMPLY',
  'TV_EMBEDDED',
  'MWEB',
  'WEB',
  'WEB_EMBEDDED',
] as const;

export type PlayerClient = (typeof KNOWN_PLAYER_CLIENTS)[number];

/**
 * Порядок фолбэков по умолчанию. Проверено с датацентрового IP: ANDROID_VR и IOS
 * отдают готовые ссылки в полном качестве и не требуют PO-токенов. Остальные
 * (WEB/MWEB/TV_SIMPLY) присылают только signatureCipher, который без JS-эвалюатора
 * расшифровать нельзя — они в дефолт не входят, но остаются доступными через env.
 */
const DEFAULT_PLAYER_CLIENTS: PlayerClient[] = ['ANDROID_VR', 'IOS', 'ANDROID', 'TV'];

/** Список фолбэк-клиентов из env PLAYER_CLIENTS (через запятую), иначе дефолтный. */
export function playerClients(): PlayerClient[] {
  const parsed = (process.env.PLAYER_CLIENTS ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is PlayerClient => (KNOWN_PLAYER_CLIENTS as readonly string[]).includes(s));
  const list = [...new Set(parsed)];
  return list.length > 0 ? list : DEFAULT_PLAYER_CLIENTS;
}

/** Сессии кэшируются по стране (gl), чтобы не плодить их на каждый запрос. */
const sessions = new Map<string, Promise<Innertube | undefined>>();
let reachable: boolean | undefined;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createInnertube(gl?: string): Promise<Innertube | undefined> {
  try {
    const yt = await Innertube.create({ location: gl });
    // Если на диске есть OAuth-токены — восстанавливаем сессию (вход).
    const tokens = await loadTokens();
    if (tokens && !yt.session.logged_in) {
      try {
        await yt.session.signIn(tokens);
      } catch (err) {
        console.warn('[yt] session signIn failed, остаёмся в гостевом режиме:', err);
      }
    }
    return yt;
  } catch (err) {
    console.error('[yt] failed to create Innertube:', err);
    return undefined;
  }
}

function getInnertube(gl?: string): Promise<Innertube | undefined> {
  const key = gl?.toUpperCase() ?? 'default';
  if (!sessions.has(key)) sessions.set(key, createInnertube(gl));
  return sessions.get(key)!;
}

/** Сессия по умолчанию (на ней живёт авторизация и данные аккаунта). */
export function getDefaultSession(): Promise<Innertube | undefined> {
  return getInnertube();
}

export async function withRetry<T>(fn: () => Promise<T>, gl?: string): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error(`[yt] attempt ${i + 1}/${RETRIES + 1} failed:`, (err as Error)?.message);
      const key = gl?.toUpperCase() ?? 'default';
      sessions.delete(key); // следующий вызов пересоздаст сессию
      if (i < RETRIES) await sleep(700 * (i + 1));
    }
  }
  throw lastErr;
}

/** Проверка доступности YouTube с нашего сервера. */
export async function checkReachable(): Promise<boolean> {
  try {
    const res = await fetch('https://www.youtube.com/', {
      method: 'HEAD',
      signal: AbortSignal.timeout(6000),
    });
    reachable = res.ok || res.status === 429 || res.status === 403;
  } catch {
    reachable = false;
  }
  return reachable!;
}

export function isReachable(): boolean | undefined {
  return reachable;
}

/* ================== player ================== */

export type Playability = 'ok' | 'login_required' | 'unavailable' | 'blocked' | 'age_restricted';

export interface PlayerFormats {
  meta: {
    id: string;
    title: string;
    description: string;
    authorId: string;
    authorName: string;
    durationSeconds: number;
    thumbnails: ReturnType<typeof toThumbnails>;
    viewCount?: number;
    likeCount?: number;
    isLive?: boolean;
    playability: Playability;
    playabilityReason?: string;
  };
  formats: VideoFormat[];
}

export function playabilityOf(status: string | undefined): Playability {
  switch (status) {
    case 'OK':
      return 'ok';
    case 'LOGIN_REQUIRED':
    case 'LOGIN_REQUIRED_AGED_GATE':
      return 'login_required';
    case 'AGE_CHECK_REQUIRED':
    case 'AGE_VERIFICATION_REQUIRED':
      return 'age_restricted';
    case 'UNPLAYABLE':
    case 'ERROR':
    case 'CONTENT_CHECK_REQUIRED':
    case 'LIVE_STREAM_OFFLINE':
      return 'unavailable';
    default:
      return status ? 'blocked' : 'ok';
  }
}

/** Не протекает спецификой библиотеки наружу — только наши типы. */
export function extractPlayer(info: unknown): PlayerFormats {
  const anyInfo = info as {
    basic_info?: Record<string, unknown>;
    primary_info?: { author?: { id?: string; name?: string } | null };
    playability_status?: { status?: string; reason?: string };
    streaming_data?: { adaptive_formats?: YtFormat[]; formats?: YtFormat[] };
  };
  const basic = anyInfo?.basic_info ?? {};
  const channel = (basic?.channel ?? {}) as { id?: string; name?: string } | null;
  const playability = anyInfo?.playability_status ?? {};
  const streaming = anyInfo?.streaming_data ?? {};
  const primary = anyInfo?.primary_info ?? {};
  const author = primary?.author ?? null;

  const meta: PlayerFormats['meta'] = {
    id: (basic?.id as string) ?? '',
    title: (basic?.title as string) ?? '',
    description: (basic?.short_description as string) ?? '',
    authorId: author?.id ?? channel?.id ?? (basic?.channel_id as string) ?? '',
    authorName: author?.name ?? (channel?.name as string) ?? (basic?.author as string) ?? '',
    durationSeconds: (basic?.duration as number) ?? 0,
    thumbnails: toThumbnails(basic?.thumbnail as never),
    viewCount: basic?.view_count as number | undefined,
    likeCount: basic?.like_count as number | undefined,
    isLive: (basic?.is_live_content as boolean) ?? false,
    playability: playabilityOf(playability?.status),
    playabilityReason: playability?.reason,
  };

  const adapter = (list: YtFormat[] | undefined) => (list ?? []).map((f) => toFormat(f));
  const formats: VideoFormat[] = [
    ...adapter(streaming?.adaptive_formats),
    ...adapter(streaming?.formats).filter((f) => f.hasVideo || f.hasAudio),
  ];

  return { meta, formats };
}

function hasPlayableVideo(formats: VideoFormat[]): boolean {
  return formats.some((f) => f.hasVideo && !f.isProtected && !!f.url);
}

/**
 * YouTube часто вместо готового url присылает signatureCipher. Такой поток
 * играбелен, но требует расшифровки через JS player (n-трансформ) — без неё все
 * форматы выглядят «без url», и прокси считал это бот-гейтом. Расшифровываем на месте.
 *
 * @returns сколько форматов получили url; failed — сколько не удалось (нет JS-эвалюатора)
 */
export async function resolveFormatUrls(info: unknown, player?: DecipherPlayer): Promise<number> {
  const stats = await decipherFormatUrls(info, player);
  if (stats.failed > 0) {
    console.warn(
      `[yt] не удалось расшифровать ${stats.failed} формат(ов) (signatureCipher без JS-эвалюатора); ` +
        `эти клиенты не годятся — оставляем те, что отдали прямые ссылки`,
    );
  }
  return stats.resolved;
}

/** Расшифровка с разбивкой по исходу: сколько получили url, сколько зафейлилось. */
export async function decipherFormatUrls(
  info: unknown,
  player?: DecipherPlayer,
): Promise<{ resolved: number; failed: number }> {
  if (!player) return { resolved: 0, failed: 0 };
  const streaming = (info as { streaming_data?: Record<string, YtFormat[] | undefined> })?.streaming_data;
  const list = [...(streaming?.adaptive_formats ?? []), ...(streaming?.formats ?? [])];

  let resolved = 0;
  let failed = 0;
  await Promise.all(list.map(async (f) => {
    if (f.url) return;
    if (!f.signature_cipher && !f.cipher) return;
    // Форматы youtubei.js умеют сами; на сырых объектах зовём player напрямую.
    const decipher = typeof f.decipher === 'function'
      ? f.decipher.bind(f)
      : () => player.decipher(f.url, f.signature_cipher, f.cipher);
    try {
      const url = await decipher(player);
      if (url) {
        f.url = url;
        resolved++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }));
  return { resolved, failed };
}

export async function getPlayer(id: string): Promise<PlayerFormats> {
  const yt = await getInnertube();
  if (!yt) throw new Error('YouTube is not reachable');
  const player = (yt.session as { player?: DecipherPlayer }).player;

  return withRetry(async () => {
    let result: PlayerFormats | undefined;
    let lastError: unknown;

    /** Расшифровывает ссылки, превращает ответ в наш DTO и пишет диагностику. */
    const attempt = async (info: unknown, source: string): Promise<PlayerFormats> => {
      const deciphered = await resolveFormatUrls(info, player);
      const parsed = extractPlayer(info);
      const playable = parsed.formats.filter((f) => f.hasVideo && !f.isProtected && !!f.url).length;
      console.log(
        `[yt] player ${id} [${source}]: playability=${parsed.meta.playability}` +
        `${parsed.meta.playabilityReason ? ` (${parsed.meta.playabilityReason})` : ''}` +
        `, ссылок с URL: ${playable}/${parsed.formats.length}` +
        `${deciphered > 0 ? `, расшифровано: ${deciphered}` : ''}`,
      );
      return parsed;
    };

    try {
      const info = await yt.getInfo(id);
      if (yt.session.logged_in) {
        void (info as { addToWatchHistory?: () => Promise<unknown> })
          .addToWatchHistory?.()
          .catch(() => undefined);
      }
      result = await attempt(info, 'WEB');
      if (hasPlayableVideo(result.formats)) return result;
    } catch (err) {
      lastError = err;
      console.warn('[yt] WEB player client failed:', err instanceof Error ? err.message : err);
    }

    for (const client of playerClients()) {
      try {
        const info = await yt.getBasicInfo(id, { client });
        result = await attempt(info, client);
        if (hasPlayableVideo(result.formats)) return result;
      } catch (err) {
        lastError = err;
        console.warn(
          `[yt] ${client} player client failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (result) return result;
    throw lastError instanceof Error
      ? lastError
      : new Error('YouTube did not return player information');
  });
}

/* ================== общие помощники ================== */

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const v = value as { toString?: () => unknown; text?: unknown };
    if (typeof v.toString === 'function') {
      const s = v.toString();
      if (typeof s === 'string' && s !== 'undefined') return s;
    }
    if (typeof v.text === 'string') return v.text;
  }
  return '';
}

/** Чистые цифры (для view_count и т.п.). */
function parseCount(value: unknown): number | undefined {
  const s = asText(value);
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  return Number(digits);
}

/** Человекочитаемое число: "2.3M" / "12K" / "1,2 млн" / "540". */
export function parseHumanCount(value: unknown): number | undefined {
  const s = asText(value).trim().replace(/\u00a0/g, ' ');
  if (!s) return undefined;
  const m = s.match(/([\d][\d.,]*)\s*([A-Za-zА-Яа-я]*)\.*/);
  if (!m) return undefined;
  const num = Number(m[1].replace(/,/g, '.'));
  if (!Number.isFinite(num)) return undefined;
  const suffix = (m[2] ?? '').toLowerCase();
  if (suffix.startsWith('млрд')) return num * 1e9;
  if (suffix.startsWith('млн')) return num * 1e6;
  if (suffix.includes('тыс')) return num * 1e3;
  const first = suffix[0];
  if (first === 'b' || first === 'в') return num * 1e9;
  if (first === 'm' || first === 'м') return num * 1e6;
  if (first === 'k' || first === 'к' || first === 'т') return num * 1e3;
  return num;
}

function parseDuration(node: { duration?: { seconds?: number }; length_text?: unknown }): number {
  const dur = node.duration;
  if (dur && typeof dur.seconds === 'number') return dur.seconds;
  const text = asText(node.length_text);
  if (!text) return 0;
  const parts = text.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] || 0;
  return 0;
}

/* ================== классификация узлов ================== */

export function toVideo(node: unknown): Video | null {
  const n = node as {
    video_id?: string;
    id?: string;
    title?: unknown;
    thumbnails?: unknown;
    author?: { id?: string; name?: string; thumbnails?: unknown };
    published?: unknown;
    view_count?: unknown;
    is_live?: boolean;
    is_upcoming?: boolean;
    upcoming?: unknown;
    duration?: { seconds?: number };
    length_text?: unknown;
  };
  const id = n?.video_id ?? n?.id;
  if (!id) return null;
  return {
    id,
    title: asText(n?.title),
    author: { id: n?.author?.id, name: n?.author?.name ?? '' },
    durationSeconds: parseDuration(n as never),
    viewCount: parseCount(n?.view_count),
    published: asText(n?.published),
    thumbnails: toThumbnails(n?.thumbnails as never),
    isLive: n?.is_live ?? false,
    isUpcoming: n?.is_upcoming ?? !!n?.upcoming,
  };
}

export function toChannel(node: unknown): ChannelInfo | null {
  const n = node as {
    id?: string;
    channel_id?: string;
    title?: unknown;
    author?: { id?: string; name?: string; thumbnails?: unknown };
    thumbnails?: unknown;
    subscribers?: unknown;
    subscriber_count?: unknown;
    video_count?: unknown;
    videos_count?: unknown;
    description_snippet?: unknown;
    channel_handle?: unknown;
    handles?: unknown;
  };
  const id = String(n?.id ?? n?.channel_id ?? '');
  if (!id) return null;
  const name =
    asText(n?.title) || asText(n?.author?.name) || asText(n?.channel_handle) || '';
  return {
    id,
    name,
    handle: asText(n?.channel_handle) || asText(n?.handles) || undefined,
    thumbnails: toThumbnails(
      (n?.thumbnails as never) ?? (n?.author?.thumbnails as never),
    ),
    subscriberCount: parseHumanCount(n?.subscribers ?? n?.subscriber_count),
    videoCount: parseHumanCount(n?.video_count ?? n?.videos_count),
    description: asText(n?.description_snippet) || undefined,
  };
}

export function toPlaylist(node: unknown): PlaylistInfo | null {
  const n = node as {
    id?: string;
    playlist_id?: string;
    title?: unknown;
    author?: { id?: string; name?: string } | unknown;
    thumbnails?: unknown;
    video_count?: unknown;
  };
  const id = String(n?.playlist_id ?? n?.id ?? '');
  if (!id) return null;
  const authorRaw = n?.author as { id?: string; name?: string } | null | undefined;
  const authorId = authorRaw?.id;
  const authorName = authorRaw?.name ?? asText(n?.author);
  return {
    id,
    title: asText(n?.title) || `Плейлист ${id}`,
    author:
      authorId || authorName
        ? { id: authorId, name: authorName }
        : undefined,
    thumbnails: toThumbnails(n?.thumbnails as never),
    videoCount: parseHumanCount(n?.video_count),
  };
}

function kindOf(n: Record<string, unknown>): 'video' | 'channel' | 'playlist' | null {
  if (typeof n.video_id === 'string' && n.video_id.length > 0) return 'video';
  const type = String(n.type ?? '');
  if (n.playlist_id || type === 'GridPlaylist' || type === 'Playlist' || type === 'CompactPlaylist')
    return 'playlist';
  if (type === 'GridChannel' || type === 'CompactChannel' || type === 'Channel') return 'channel';
  if (typeof n.channel_id === 'string' && n.channel_id.length > 0) return 'channel';
  return null;
}

function toItem(node: unknown): FeedItem | null {
  const n = node as Record<string, unknown>;
  const kind = kindOf(n);
  if (kind === 'video') {
    const v = toVideo(node);
    return v ? { type: 'video', video: v } : null;
  }
  if (kind === 'channel') {
    const c = toChannel(node);
    return c ? { type: 'channel', channel: c } : null;
  }
  if (kind === 'playlist') {
    const p = toPlaylist(node);
    return p ? { type: 'playlist', playlist: p } : null;
  }
  return null;
}

const LIST_KEYS = ['content', 'contents', 'items', 'results', 'videos', 'channels', 'playlists', 'elements'];

/**
 * Рекурсивный сбор универсальных элементов (video/channel/playlist) в порядке отображения.
 * Классифицированный узел — лист: внутрь не ходим (иначе вложенные `channel` видео
 * ловились бы как отдельные карточки каналов).
 */
export function collectItems(root: unknown): FeedItem[] {
  const out: FeedItem[] = [];
  const seen = new Set<object>();
  const dedupe = new Set<string>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const item = toItem(node);
    if (item) {
      const key = `${item.type}:${item.type === 'video' ? item.video.id : item.type === 'channel' ? item.channel.id : item.playlist.id}`;
      if (!dedupe.has(key)) {
        dedupe.add(key);
        out.push(item);
      }
      return; // лист
    }

    const n = node as Record<string, unknown>;
    for (const key of LIST_KEYS) {
      if (n[key] !== undefined) walk(n[key]);
    }
  };

  walk(root);
  return out;
}

export function feedItemsOf(feed: unknown): FeedItem[] {
  return collectItems(feed);
}

/** Полки главной: узел с title и списком содержимого → строка ленты. */
export function collectRows(root: unknown): FeedRow[] {
  const rows: FeedRow[] = [];
  const seen = new Set<object>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const n = node as Record<string, unknown>;
    const hasTitle = n.title !== undefined || n.header !== undefined;
    const contents = Array.isArray(n.contents) ? n.contents : undefined;
    if (hasTitle && contents) {
      const items = collectItems(contents);
      if (items.length > 0) {
        const title = asText(n.title ?? (n.header as { title?: unknown } | undefined)?.title);
        rows.push({ title: title || undefined, items });
        return; // заголовок + полка = лист
      }
    }
    for (const key of ['content', 'contents', 'items']) {
      if (n[key] !== undefined) walk(n[key]);
    }
  };

  walk(root);
  return rows;
}

/* ================== продолжения (бесконечный скролл) ================== */

interface ContEntry {
  src: FeedSource;
  feed: FeedLike;
  tab?: ChannelTab;
}

class ContinuationStore {
  private map = new Map<string, ContEntry>();
  private order: string[] = [];

  put(entry: ContEntry): string {
    const token = randomBytes(9).toString('base64url');
    this.map.set(token, entry);
    this.order.push(token);
    if (this.order.length > 64) {
      const oldest = this.order.shift();
      if (oldest) this.map.delete(oldest);
    }
    return token;
  }

  get(token: string): ContEntry | undefined {
    this.order = this.order.filter((t) => t !== token);
    const entry = this.map.get(token);
    if (entry) this.order.push(token); // MRU
    return entry;
  }

  has(token: string): boolean {
    return this.map.has(token);
  }
}

export const continuations = new ContinuationStore();

/** Достаёт следующую порцию и перекладывает продолжение в store (или null). */
export async function nextOfFeed(entry: ContEntry): Promise<NextResponse | null> {
  const next = await entry.feed.getContinuation?.();
  if (!next) return null;
  const items = collectItems(next);
  const continuation =
    next && next.has_continuation
      ? continuations.put({ src: entry.src, feed: next, tab: entry.tab })
      : undefined;
  return { items, continuation };
}

/* ================== browse / search ================== */

export interface HomeData {
  sections: FeedRow[];
  continuation?: string;
}

export async function getHome(gl?: string): Promise<HomeData> {
  const yt = await getInnertube(gl);
  if (!yt) throw new Error('YouTube is not reachable');

  return withRetry(
    async () => {
      const feed = await yt.getHomeFeed();
      let sections = collectRows(feed);
      if (sections.length === 0) {
        // Анонимный клиент часто отдаёт вместо ленты только "nudge".
        sections = await fallbackHome(gl);
      }
      const continuation =
        feed && (feed as FeedLike).has_continuation
          ? continuations.put({ src: 'browse', feed: feed as unknown as FeedLike })
          : undefined;
      return { sections, continuation };
    },
    gl,
  );
}

const DEFAULT_HOME_QUERIES = [
  { query: 'funny videos', title: 'Trending' },
  { query: 'music videos', title: 'Music' },
  { query: 'popular right now', title: 'Popular' },
];

async function fallbackHome(gl?: string): Promise<FeedRow[]> {
  const sections: FeedRow[] = [];
  for (const topic of DEFAULT_HOME_QUERIES) {
    try {
      const res = await getSearch(topic.query, gl);
      if (res.items.length > 0) sections.push({ title: topic.title, items: res.items });
    } catch {
      // пропускаем недоступную тему
    }
  }
  return sections;
}

export async function getSearch(query: string, gl?: string): Promise<SearchResponse> {
  const yt = await getInnertube(gl);
  if (!yt) throw new Error('YouTube is not reachable');

  return withRetry(
    async () => {
      const page = await yt.search(query);
      const items = collectItems(page);
      const continuation =
        page && (page as FeedLike).has_continuation
          ? continuations.put({ src: 'search', feed: page as unknown as FeedLike })
          : undefined;
      return { items, continuation };
    },
    gl,
  );
}

/* ================== channel ================== */

const TAB_METHOD: Record<string, (ch: unknown) => Promise<FeedLike>> = {
  videos: async (ch) => (ch as { getVideos: () => Promise<FeedLike> }).getVideos(),
  shorts: async (ch) => (ch as { getShorts: () => Promise<FeedLike> }).getShorts(),
  live: async (ch) => (ch as { getLiveStreams: () => Promise<FeedLike> }).getLiveStreams(),
  playlists: async (ch) => (ch as { getPlaylists: () => Promise<FeedLike> }).getPlaylists(),
  releases: async (ch) => (ch as { getReleases: () => Promise<FeedLike> }).getReleases(),
  podcasts: async (ch) => (ch as { getPodcasts: () => Promise<FeedLike> }).getPodcasts(),
};

function channelMeta(channel: unknown): ChannelInfo {
  const c = channel as {
    metadata?: {
      title?: string;
      description?: string;
      avatar?: unknown;
      vanity_channel_url?: string;
      external_id?: string;
    };
    header?: {
      author?: { id?: string; name?: string; thumbnails?: unknown };
      subscribers?: unknown;
      videos_count?: unknown;
      channel_handle?: unknown;
      banner?: unknown;
    };
  };
  const meta = c.metadata ?? {};
  const header = c.header ?? {};
  const author = header.author;
  return {
    id: author?.id ?? meta.external_id ?? '',
    name: (author?.name ?? meta.title ?? '').trim() || 'Канал',
    handle: asText(header.channel_handle) || undefined,
    thumbnails: toThumbnails((author?.thumbnails as never) ?? (meta.avatar as never)),
    banner: toThumbnails(header.banner as never),
    subscriberCount: parseHumanCount(header.subscribers),
    videoCount: parseHumanCount(header.videos_count),
    description: meta.description || undefined,
  };
}

function channelTabs(channel: unknown): ChannelResponse['tabs'] {
  const tabs = (channel as { tabs?: { title?: unknown }[] }).tabs ?? [];
  const map: Record<string, string> = {
    home: 'Главная',
    videos: 'Видео',
    shorts: 'Shorts',
    live: 'Live',
    playlists: 'Плейлисты',
    podcasts: 'Подкасты',
    releases: 'Релизы',
  };
  return tabs
    .map((t) => {
      const title = asText(t.title);
      const key = Object.entries(map).find(([, ru]) => ru.toLowerCase() === title.toLowerCase())?.[0];
      const id: ChannelTab =
        (key as ChannelTab) ||
        (((['home', 'videos', 'shorts', 'live', 'playlists', 'podcasts', 'releases'] as ChannelTab[]).find(
          (k) => k === title.toLowerCase(),
        ) as ChannelTab) ?? ('videos' as ChannelTab));
      return { id, title };
    })
    .filter((t) => t.id !== 'home')
    .slice(0, 5);
}

export async function getChannel(id: string, tab: ChannelTab, gl?: string): Promise<ChannelResponse> {
  const yt = await getInnertube(gl);
  if (!yt) throw new Error('YouTube is not reachable');

  return withRetry(
    async () => {
      const channel = await yt.getChannel(id);
      const meta = channelMeta(channel);
      const tabs = channelTabs(channel);

      let feed: FeedLike = channel as unknown as FeedLike;
      if (tab && tab !== 'home' && TAB_METHOD[tab]) {
        try {
          feed = await TAB_METHOD[tab](channel);
        } catch {
          feed = channel as unknown as FeedLike; // вкладки нет — показываем главную
        }
      }

      const items = collectItems(feed);
      const restricted = items.length === 0;
      const continuation =
        feed && feed.has_continuation
          ? continuations.put({ src: 'channel', feed, tab })
          : undefined;
      return { channel: meta, tabs, items, continuation, restricted };
    },
    gl,
  );
}

/* ================== playlist ================== */

export async function getPlaylist(id: string, gl?: string): Promise<PlaylistResponse> {
  const yt = await getInnertube(gl);
  if (!yt) throw new Error('YouTube is not reachable');

  return withRetry(
    async () => {
      const pl = await yt.getPlaylist(id);
      const info = pl.info ?? {};
      const author = info.author as { id?: string; name?: string } | null | undefined;
      const playlist: PlaylistInfo = {
        id,
        title: (info.title as string) || asText((pl as { endpoint?: unknown }).endpoint) || `Плейлист ${id}`,
        author: author
          ? { id: author.id, name: author.name ?? '' }
          : undefined,
        thumbnails: toThumbnails(info.thumbnails as never),
        videoCount: parseHumanCount(info.total_items),
      };
      const items = collectItems(pl);
      const continuation =
        pl && (pl as FeedLike).has_continuation
          ? continuations.put({ src: 'playlist', feed: pl as unknown as FeedLike })
          : undefined;
      return { playlist, items, continuation };
    },
    gl,
  );
}

/* ================== live / subscriptions ================== */

export async function getLive(gl?: string): Promise<SearchResponse> {
  const yt = await getInnertube(gl);
  if (!yt) throw new Error('YouTube is not reachable');

  return withRetry(
    async () => {
      const page = await yt.search('live', { type: 'video', features: ['live'] });
      const items = collectItems(page);
      const feed = (items.length > 0 ? page : undefined) as FeedLike | undefined;
      const continuation =
        feed && feed.has_continuation
          ? continuations.put({ src: 'live', feed })
          : undefined;
      return { items, continuation };
    },
    gl,
  );
}

export async function getSubscriptions(gl?: string): Promise<SearchResponse> {
  const yt = await getInnertube(gl);
  if (!yt) throw new Error('YouTube is not reachable');

  return withRetry(
    async () => {
      const feed = await yt.getSubscriptionsFeed();
      return { items: collectItems(feed) };
    },
    gl,
  );
}

/** История аккаунта (только при входе). Best-effort: при ошибке — пусто. */
export async function getAccountHistory(): Promise<FeedItem[]> {
  const yt = await getInnertube();
  if (!yt || !yt.session.logged_in) return [];
  try {
    return await withRetry(async () => collectItems(await yt.getHistory()), undefined);
  } catch (err) {
    console.warn('[yt] getHistory failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/* ================== комментарии / рекомендации ================== */

/** Маппинг порции комментариев youtubei.js → компактные DTO для веба. */
export function toComments(node: unknown): CommentInfo[] {
  const root = node as { contents?: unknown } | null | undefined;
  const list = (root?.contents ?? []) as Array<Record<string, unknown>>;
  const out: CommentInfo[] = [];
  for (const t of list) {
    const comment = t?.comment as
      | (Record<string, unknown> & {
          comment_id?: string;
          author?: {
            name?: string;
            thumbnails?: { url?: string }[];
            endpoint?: { payload?: { browseId?: string } };
          };
          content?: unknown;
          published_time?: string;
          like_count?: string;
          reply_count?: string;
          is_pinned?: boolean;
        })
      | null;
    if (!comment) continue;
    const id = String(comment.comment_id ?? '');
    const content = asText(comment.content);
    if (!id && !content) continue;
    const rc = comment.reply_count?.trim() ?? '';
    out.push({
      id,
      author: {
        id: comment.author?.endpoint?.payload?.browseId || undefined,
        name: comment.author?.name || 'Аноним',
      },
      avatarUrl: comment.author?.thumbnails?.[0]?.url,
      content,
      publishedTime: comment.published_time,
      likeCount: comment.like_count,
      replyCount: rc && /^\d+$/.test(rc) ? Number(rc) : undefined,
      isPinned: !!comment.is_pinned,
      hasReplies: !!t?.has_replies || !!t?.replies,
    });
  }
  return out;
}

export async function getComments(videoId: string, gl?: string): Promise<CommentsResponse> {
  const yt = await getInnertube(gl);
  if (!yt) throw new Error('YouTube is not reachable');

  return withRetry(
    async () => {
      const c = await yt.getComments(videoId, 'TOP_COMMENTS');
      const comments = toComments(c);
      const continuation = c.has_continuation
        ? continuations.put({ src: 'comments', feed: c as unknown as FeedLike })
        : undefined;
      return { comments, continuation };
    },
    gl,
  );
}

/** Следующая порция комментариев (для /api/v1/next?src=comments). */
export async function nextComments(entry: ContEntry): Promise<CommentsResponse | null> {
  const next = await entry.feed.getContinuation?.();
  if (!next) return null;
  const comments = toComments(next);
  const continuation = next.has_continuation
    ? continuations.put({ src: 'comments', feed: next })
    : undefined;
  return { comments, continuation };
}

interface VideoInfoLike {
  watch_next_feed?: unknown;
  autoplay?: {
    sets?: { autoplay_video?: { payload?: { videoId?: string } } }[];
  };
  getWatchNextContinuation?: () => Promise<VideoInfoLike>;
}

/** Чистая логика выбора «следующего видео» (изоляция для unit-тестов). */
export function pickUpNext(items: FeedItem[], autoplayVideoId?: string): Video | undefined {
  if (autoplayVideoId) {
    const found = items.find(
      (i): i is { type: 'video'; video: Video } => i.type === 'video' && i.video.id === autoplayVideoId,
    );
    if (found) return found.video;
    return {
      id: autoplayVideoId,
      title: 'Далее',
      author: { name: '' },
      durationSeconds: 0,
      thumbnails: [],
    };
  }
  return items[0]?.type === 'video' ? items[0].video : undefined;
}

/** Рекомендации к видео: watch-next лента + автоплеевское «следующее». */
export async function getRelated(videoId: string, gl?: string): Promise<RelatedResponse> {
  const yt = await getInnertube(gl);
  if (!yt) throw new Error('YouTube is not reachable');

  return withRetry(
    async () => {
      const info = (await yt.getInfo(videoId)) as unknown as VideoInfoLike;
      const items = collectItems(info.watch_next_feed ?? []);

      // Лента пуста (частый случай из-за бот-гейта на датацентре) — не отдаём «мёртвый» upNext.
      if (items.length === 0) return { items: [], continuation: undefined };

      const upNext = pickUpNext(items, info.autoplay?.sets?.[0]?.autoplay_video?.payload?.videoId);

      const feed = info.getWatchNextContinuation
        ? ({
            has_continuation: true,
            getContinuation: () => info.getWatchNextContinuation!(),
          } as unknown as FeedLike)
        : undefined;
      const continuation = feed ? continuations.put({ src: 'related', feed }) : undefined;

      return { items, upNext, continuation };
    },
    gl,
  );
}