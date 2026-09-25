import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import type {
  AuthStatus,
  BackupDocument,
  BackupResult,
  BrowseResponse,
  ChannelResponse,
  ChannelTab,
  ChatPollResponse,
  CommentsResponse,
  DeviceFlowResponse,
  EngagementBody,
  EngagementResult,
  FavoritesResponse,
  HealthResponse,
  HistoryResponse,
  LiveChatResponse,
  NextResponse,
  PairingPollResponse,
  PairingSendBody,
  PairingSendResponse,
  PairingStartResponse,
  PairingStatusResponse,
  PlayerResponse,
  PlaylistResponse,
  RelatedResponse,
  SearchResponse,
  VideoCodec,
} from '@stfw/shared';
import { buildMpd, type MpdBuildResult } from './mpd.js';
import { TtlCache } from './cache.js';
import { authStatus, engage, logout, pollDeviceAuth, startDeviceFlow } from './auth.js';
import { addFavorite, clearFavorites, listFavorites, removeFavorite } from './favorites.js';
import { getBackup, saveBackup } from './backup.js';
import { pollLiveChat, startLiveChat } from './chat.js';
import {
  checkReachable,
  continuations,
  getAccountHistory,
  getChannel,
  getComments,
  getHome,
  getLive,
  getPlaylist,
  getPlayer,
  getRelated,
  getSearch,
  getSubscriptions,
  isReachable,
  nextComments,
  nextOfFeed,
} from './yt.js';
import { PairingCenter, parseVideoId } from './pairing.js';
import { decideDemo, resolveDemoMode } from './demo.js';
import { localizeUrls, registerProxyUrl, resolveProxyToken, type ProxyKind } from './proxy.js';

const pairingCenter = new PairingCenter();

const PORT = Number(process.env.PORT ?? 3090);
const HOST = process.env.HOST ?? '0.0.0.0';
const VERSION = '0.0.0';
const STARTED_AT = Date.now();

/** Режим демо-контента: auto (по детекту) / on (всегда демо) / off (никогда). */
const DEMO_MODE = resolveDemoMode(process.env.DEMO_MODE);

/** Проксировать ли потоки через наш сервер (иначе браузер тянет googlevideo напрямую). */
const PROXY_STREAMS = process.env.PROXY_STREAMS !== '0';

const playerCache = new TtlCache<PlayerResponse>(10 * 60 * 1000);
const homeCache = new TtlCache<BrowseResponse>(5 * 60 * 1000);
const searchCache = new TtlCache<SearchResponse>(5 * 60 * 1000);
const channelCache = new TtlCache<ChannelResponse>(10 * 60 * 1000);
const playlistCache = new TtlCache<PlaylistResponse>(10 * 60 * 1000);
const feedCache = new TtlCache<SearchResponse>(3 * 60 * 1000);
const commentsCache = new TtlCache<CommentsResponse>(10 * 60 * 1000);
const relatedCache = new TtlCache<RelatedResponse>(10 * 60 * 1000);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.addHook('preSerialization', async (_request, _reply, payload) => {
  return PROXY_STREAMS ? localizeUrls(payload) : payload;
});

await app.register(cors, {
  origin: true, // любой источник: dev на :5173, prod nginx, сам ТВ между собой
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoAssetsDir = join(__dirname, '../assets/demo');

/** Демо-манифест: используется, когда с IP сервера YouTube не выдаёт URL потоков. */
const DEMO_MANIFEST_PATH = '/api/v1/demo/media.mpd';

await app.register(fastifyStatic, {
  root: demoAssetsDir,
  prefix: '/api/v1/demo/',
  decorateReply: false,
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
  },
});

async function tryReachability(): Promise<boolean> {
  try {
    return await checkReachable();
  } catch {
    return false;
  }
}

/* ---------- HTTP-хелперы ---------- */

function fail(reply: FastifyReply, code: number, message: string) {
  return reply.code(code).send({ error: message });
}

/* ---------- routes ---------- */

app.get('/api/v1/health', async (req, reply): Promise<HealthResponse> => {
  let reachable = isReachable();
  if (reachable === undefined) reachable = await tryReachability();
  return reply.send({
    status: 'ok',
    version: VERSION,
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    youtubeReachable: reachable,
    demoMode: DEMO_MODE,
    proxyStreams: PROXY_STREAMS,
  });
});

app.get<{ Querystring: { gl?: string } }>('/api/v1/browse', async (req, reply) => {
  const gl = req.query.gl;
  const cacheKey = `home:${gl ?? 'default'}`;
  const cached = homeCache.get(cacheKey);
  if (cached) return reply.send(cached);

  try {
    await tryReachability();
    const home = await getHome(gl);
    const body: BrowseResponse = { sections: home.sections, continuation: home.continuation };
    homeCache.set(cacheKey, body);
    return reply.send(body);
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось получить главную ленту от YouTube');
  }
});

app.get<{ Querystring: { q?: string; gl?: string } }>('/api/v1/search', async (req, reply) => {
  const q = (req.query.q ?? '').trim();
  if (!q) return fail(reply, 400, 'Параметр q обязателен');
  const cacheKey = `search:${q}:${req.query.gl ?? 'default'}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return reply.send(cached);

  try {
    const res = await getSearch(q, req.query.gl);
    searchCache.set(cacheKey, res);
    return reply.send(res);
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось выполнить поиск');
  }
});

app.get<{ Querystring: { id?: string; tab?: string; gl?: string } }>(
  '/api/v1/channel',
  async (req, reply) => {
    const chId = (req.query.id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{6,}$/.test(chId)) return fail(reply, 400, 'Некорректный id канала');

    const requestedTab = req.query.tab?.trim() as ChannelTab | undefined;
    const validTabs: ChannelTab[] = ['home', 'videos', 'shorts', 'live', 'playlists', 'podcasts', 'releases'];
    const tab = requestedTab && validTabs.includes(requestedTab) ? requestedTab : 'videos';
    const cacheKey = `channel:${chId}:${tab}:${req.query.gl ?? 'default'}`;
    const cached = channelCache.get(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const res = await getChannel(chId, tab, req.query.gl);
      channelCache.set(cacheKey, res);
      return reply.send(res);
    } catch (err) {
      app.log.error(err);
      return fail(reply, 502, 'Не удалось загрузить канал');
    }
  },
);

app.get<{ Querystring: { id?: string; gl?: string } }>('/api/v1/playlist', async (req, reply) => {
  const plId = (req.query.id ?? '').trim().replace(/^VL/, '');
  if (!/^[A-Za-z0-9_-]{6,}$/.test(plId)) return fail(reply, 400, 'Некорректный id плейлиста');
  const cacheKey = `playlist:${plId}:${req.query.gl ?? 'default'}`;
  const cached = playlistCache.get(cacheKey);
  if (cached) return reply.send(cached);

  try {
    const res = await getPlaylist(plId, req.query.gl);
    playlistCache.set(cacheKey, res);
    return reply.send(res);
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось загрузить плейлист');
  }
});

app.get<{ Querystring: { src?: string; token?: string } }>('/api/v1/next', async (req, reply) => {
  const src = req.query.src;
  const token = req.query.token;
  if (!src || !token) return fail(reply, 400, 'Параметры src и token обязательны');
  const entry = continuations.get(token);
  if (!entry) return fail(reply, 404, 'Продолжение истекло — обновите страницу');

  try {
    if (src === 'comments') {
      const body = (await nextComments(entry)) ?? { comments: [], continuation: undefined };
      return reply.send(body);
    }
    const body: NextResponse = (await nextOfFeed(entry)) ?? { items: [], continuation: undefined };
    return reply.send(body);
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось загрузить продолжение');
  }
});

/** Комментарии к видео (top comments + продолжение через /next?src=comments). */
app.get<{ Querystring: { id?: string; gl?: string } }>('/api/v1/comments', async (req, reply) => {
  const id = (req.query.id ?? '').trim();
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return fail(reply, 400, 'Некорректный id видео');
  const cacheKey = `comments:${id}`;
  const cached = commentsCache.get(cacheKey);
  if (cached) return reply.send(cached);
  try {
    const res = await getComments(id, req.query.gl);
    commentsCache.set(cacheKey, res);
    return reply.send(res);
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось загрузить комментарии');
  }
});

/** Рекомендации («далее»/«похожие») для страницы плеера. */
app.get<{ Querystring: { id?: string; gl?: string } }>('/api/v1/related', async (req, reply) => {
  const id = (req.query.id ?? '').trim();
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return fail(reply, 400, 'Некорректный id видео');
  const cacheKey = `related:${id}`;
  const cached = relatedCache.get(cacheKey);
  if (cached) return reply.send(cached);
  try {
    const res = await getRelated(id, req.query.gl);
    relatedCache.set(cacheKey, res);
    return reply.send(res);
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось загрузить рекомендации');
  }
});

/** Лента live-трансляций (поисковый фильтр features:live). */
app.get<{ Querystring: { gl?: string } }>('/api/v1/live', async (req, reply) => {
  const cacheKey = `live:${req.query.gl ?? 'default'}`;
  const cached = feedCache.get(cacheKey);
  if (cached) return reply.send(cached);
  try {
    const res = await getLive(req.query.gl);
    feedCache.set(cacheKey, res);
    return reply.send(res);
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось получить live-ленту');
  }
});

/** Подписки (гостевой режим → пусто; вход — Фаза 3). */
app.get<{ Querystring: { gl?: string } }>('/api/v1/subscriptions', async (req, reply) => {
  const cacheKey = `subs:${req.query.gl ?? 'default'}`;
  const cached = feedCache.get(cacheKey);
  if (cached) return reply.send(cached);
  try {
    const res = await getSubscriptions(req.query.gl);
    feedCache.set(cacheKey, res);
    return reply.send(res);
  } catch (err) {
    app.log.warn(err);
    return reply.send({ items: [] });
  }
});

app.get<{ Querystring: { id?: string } }>('/api/v1/player', async (req, reply) => {
  const id = (req.query.id ?? '').trim();
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return fail(reply, 400, 'Некорректный id видео');

  const cached = playerCache.get(id);
  if (cached) return reply.send(cached);

  try {
    const p = await getPlayer(id);
    const videoFormats = p.formats.filter(
      (f) => f.hasVideo && !f.isProtected && f.url && f.url.length > 0,
    );
    const liveAvailable = videoFormats.length > 0;
    const decision = decideDemo(DEMO_MODE, liveAvailable, false);
    if (!decision.useDemo && !liveAvailable) {
      app.log.warn(
        `[player] ${id} — YouTube не отдал потоки с этого IP, но DEMO_MODE=off, отдаю 502`,
      );
      return fail(reply, 502, 'YouTube не отдал потоки с этого IP (бот-гейт). Используйте DEMO_MODE=auto или домашний IP.');
    }
    if (decision.useDemo) app.log.warn(`[player] ${id} — демо-режим (${decision.reason})`);
    const manifestPath = decision.useDemo ? DEMO_MANIFEST_PATH : `/api/v1/manifest/${id}.mpd`;
    const body: PlayerResponse = {
      id: p.meta.id,
      title: p.meta.title,
      description: p.meta.description,
      author: { id: p.meta.authorId, name: p.meta.authorName },
      durationSeconds: p.meta.durationSeconds,
      thumbnails: p.meta.thumbnails,
      playability: p.meta.playability,
      playabilityReason: p.meta.playabilityReason,
      viewCount: p.meta.viewCount,
      likeCount: p.meta.likeCount,
      isLive: p.meta.isLive,
      formats: p.formats,
      manifestPath,
      demo: decision.useDemo,
    };
    playerCache.set(id, body);
    return reply.send(body);
  } catch (err) {
    // YouTube блокирует/недоступен с этого IP (rate-limit, tarpit):
    // в режимах auto|on вместо 502 отдаём детерминированный демо-контент.
    const msg = err instanceof Error ? err.message : String(err);
    const unreachable = /reachable|fetch failed|connect|timeout|tarpit|ECONN|ETIMEDOUT/i.test(msg);
    const decision = decideDemo(
      process.env.DISABLE_DEMO_FALLBACK === '1' ? 'off' : DEMO_MODE,
      false,
      unreachable,
    );
    if (decision.useDemo) {
      app.log.warn(`[player] ${id} — YouTube недоступен (${msg}), служу демо-манифестом`);
      const fallback: PlayerResponse = {
        id,
        title: `Демо: видео ${id}`,
        description: 'YouTube не отвечает с этого сервера. Показываем тестовый DASH-ролик.',
        author: { id: '', name: 'SmartTube WEB' },
        durationSeconds: 60,
        thumbnails: [],
        playability: 'unavailable',
        playabilityReason: 'youtube_unreachable',
        formats: [],
        manifestPath: DEMO_MANIFEST_PATH,
        demo: true,
      };
      return reply.send(fallback);
    }
    app.log.error(err);
    return fail(reply, 502, 'Не удалось загрузить видео');
  }
});

app.get<{
  Params: { id: string };
  Querystring: { codec?: string; maxHeight?: string; sel?: string };
}>('/api/v1/manifest/:id.mpd', async (req, reply) => {
  const id = req.params.id;
  const cached = playerCache.get(id);
  if (!cached) return fail(reply, 404, 'Видео не найдено в кэше — сначала вызовите /player');

  const codecOptions: VideoCodec[] = ['avc', 'vp9', 'av01'];
  const codec = (req.query.codec ?? 'vp9') as VideoCodec;
  if (!codecOptions.includes(codec)) return fail(reply, 400, 'Неизвестный кодек');
  const maxHeight = req.query.maxHeight ? Number(req.query.maxHeight) : undefined;
  const useProxy = PROXY_STREAMS;

  const video = cached.formats.filter((f) => f.hasVideo && !f.isProtected && f.url);
  const audio = cached.formats.filter((f) => f.hasAudio && !f.isProtected && f.url);

  const remap = (url?: string) => (useProxy ? registerProxyUrl(url, 'media') : url);
  const videoFormats = video.map((f) => ({ ...f, url: remap(f.url) })).filter((f) => f.url);
  const audioFormats = audio.map((f) => ({ ...f, url: remap(f.url) })).filter((f) => f.url);
  if (useProxy && videoFormats.length === 0) {
    return fail(reply, 502, 'Не удалось создать локальные прокси для видеопотоков');
  }

  const result: MpdBuildResult = buildMpd({
    videoId: id,
    durationSeconds: cached.durationSeconds,
    videoFormats,
    audioFormats,
    selection: { codec, maxHeight, allowProgressive: true },
  });

  reply.header('Content-Type', 'application/dash+xml');
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Cache-Control', 'public, max-age=300');
  return reply.send(result.mpd);
});

const MAX_RANGE_BYTES = 32 * 1024 * 1024;

function parseRange(value: string | undefined): string | null | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if (
    (start !== undefined && !Number.isSafeInteger(start)) ||
    (end !== undefined && !Number.isSafeInteger(end))
  ) {
    return null;
  }
  if (
    start !== undefined &&
    end !== undefined &&
    (end < start || end - start + 1 > MAX_RANGE_BYTES)
  ) {
    return null;
  }
  if (start === undefined && end !== undefined && end + 1 > MAX_RANGE_BYTES) {
    return null;
  }
  return value;
}

type ProxyRequest = FastifyRequest<{ Params: { token: string } }>;

async function proxyRequest(kind: ProxyKind, req: ProxyRequest, reply: FastifyReply) {
  const target = resolveProxyToken(req.params.token, kind);
  if (!target) return fail(reply, 404, 'Медиатокен не найден или истёк');
  const range = parseRange(req.headers.range);
  if (range === null) return fail(reply, 416, 'Некорректный Range');

  try {
    const upstream = await fetch(target, {
      headers: {
        ...(range ? { Range: range } : {}),
        'User-Agent': 'Mozilla/5.0 (SmartTubeWeb)',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) return fail(reply, upstream.status, 'Upstream error');
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    if (kind === 'asset' && !contentType.toLowerCase().startsWith('image/')) {
      return fail(reply, 415, 'Upstream asset is not an image');
    }
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    reply.header('Content-Type', contentType);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header(
      'Cache-Control',
      kind === 'media' ? 'private, max-age=60' : 'public, max-age=86400',
    );
    if (contentLength) reply.header('Content-Length', contentLength);
    if (contentRange) reply.header('Content-Range', contentRange);
    if (kind === 'media') reply.header('Accept-Ranges', 'bytes');
    reply.code(upstream.status);
    if (!upstream.body) return fail(reply, 502, 'Нет тела ответа');
    return reply.send(ReadableStreamToNode(upstream.body));
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Proxy error');
  }
}

app.get<{ Params: { token: string } }>('/api/v1/stream/:token', async (req, reply) => {
  return proxyRequest('media', req, reply);
});

app.get<{ Params: { token: string } }>('/api/v1/asset/:token', async (req, reply) => {
  return proxyRequest('asset', req, reply);
});

app.get('/api/v1/stream', async (_req, reply) => {
  return fail(reply, 410, 'Прямые URL потоков отключены');
});

function ReadableStreamToNode(web: ReadableStream<Uint8Array>): Readable {
  return Readable.from(web as unknown as AsyncIterable<Uint8Array>);
}

app.get<{ Querystring: { videoId?: string; categories?: string } }>(
  '/api/v1/sponsorblock',
  async (req, reply) => {
    const videoId = (req.query.videoId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return reply.send([]);
    const allowedCategories = new Set(['sponsor', 'intro', 'outro', 'selfpromo']);
    const categories = (req.query.categories ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => allowedCategories.has(item));
    if (categories.length === 0) return reply.send([]);

    const target = new URL('https://sponsor.ajay.app/api/skipSegments');
    target.searchParams.set('videoID', videoId);
    target.searchParams.set('categories', categories.join(','));
    try {
      const upstream = await fetch(target, {
        headers: { 'User-Agent': 'Mozilla/5.0 (SmartTubeWeb)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!upstream.ok) return reply.send([]);
      const data: unknown = await upstream.json();
      return reply.send(Array.isArray(data) ? data : []);
    } catch (err) {
      app.log.warn(err);
      return reply.send([]);
    }
  },
);

/* ---------- аккаунт (Фаза 3) ---------- */

/** Статус авторизации (гость/вход, профиль, текущий device-код). */
app.get('/api/v1/auth/status', async (_req, reply): Promise<AuthStatus> => {
  try {
    return reply.send(await authStatus());
  } catch (err) {
    app.log.error(err);
    return fail(reply, 500, 'Не удалось получить статус авторизации');
  }
});

/** Начать вход по коду устройства. */
app.post('/api/v1/auth/device', async (_req, reply): Promise<DeviceFlowResponse> => {
  try {
    return reply.send(await startDeviceFlow());
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось начать вход');
  }
});

/** Поллинг входа (пока пользователь подтверждает на телефоне). */
app.get('/api/v1/auth/poll', async (_req, reply): Promise<DeviceFlowResponse> => {
  try {
    return reply.send(await pollDeviceAuth());
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось проверить статус входа');
  }
});

app.post('/api/v1/auth/logout', async (_req, reply): Promise<{ ok: boolean }> => {
  try {
    await logout();
    return reply.send({ ok: true });
  } catch (err) {
    app.log.error(err);
    return fail(reply, 500, 'Не удалось выйти');
  }
});

/** Лайк/дизлайк/оценка/подписка от имени аккаунта. */
app.post<{ Body?: EngagementBody }>('/api/v1/engagement', async (req, reply): Promise<EngagementResult> => {
  const body: EngagementBody = req.body ?? {};
  if (!body.action) return fail(reply, 400, 'Параметр action обязателен');
  const result = await engage(body);
  if (!result.ok) return reply.code(403).send(result);
  return reply.send(result);
});

/** История аккаунта (только при входе). */
app.get('/api/v1/history', async (_req, reply): Promise<HistoryResponse> => {
  try {
    return reply.send({ items: await getAccountHistory() });
  } catch (err) {
    app.log.error(err);
    return fail(reply, 502, 'Не удалось загрузить историю аккаунта');
  }
});

/* ---------- избранное / бэкап / лайв-чат (Фаза 3) ---------- */

app.get('/api/v1/favorites', async (_req, reply): Promise<FavoritesResponse> => {
  return reply.send(await listFavorites());
});

app.post<{ Body?: { id?: string; title?: string; authorName?: string } }>(
  '/api/v1/favorites',
  async (req, reply): Promise<FavoritesResponse> => {
    const { id, title } = req.body ?? {};
    if (!id || !title) return fail(reply, 400, 'Параметры id и title обязательны');
    return reply.send(
      await addFavorite({ id, title, authorName: req.body?.authorName, addedAt: Date.now() }),
    );
  },
);

app.post<{ Body?: { id?: string } }>('/api/v1/favorites/remove', async (req, reply): Promise<FavoritesResponse> => {
  const id = req.body?.id;
  if (!id) return fail(reply, 400, 'Параметр id обязателен');
  return reply.send(await removeFavorite(id));
});

app.post('/api/v1/favorites/clear', async (_req, reply): Promise<FavoritesResponse> => {
  return reply.send(await clearFavorites());
});

/** Сохранить резервную копию (code необязателен — сгенерируется). */
app.post<{ Body?: { code?: string; data?: Record<string, unknown> } }>(
  '/api/v1/backup',
  async (req, reply): Promise<BackupResult> => {
    const data = req.body?.data;
    if (!data || typeof data !== 'object') return fail(reply, 400, 'Параметр data обязателен');
    return reply.send(await saveBackup(req.body?.code, data));
  },
);

/** Получить резервную копию по коду. */
app.get<{ Params: { code: string } }>(
  '/api/v1/backup/:code',
  async (req, reply): Promise<BackupDocument> => {
    const doc = await getBackup(req.params.code);
    if (!doc) return fail(reply, 404, 'Код не найден');
    return reply.send(doc);
  },
);

/** Старт лайв-чата: буфер последних сообщений + счётчик after. */
app.get<{ Querystring: { id?: string } }>(
  '/api/v1/live/chat',
  async (req, reply): Promise<LiveChatResponse> => {
    const id = (req.query.id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return fail(reply, 400, 'Некорректный id видео');
    try {
      return reply.send(await startLiveChat(id));
    } catch (err) {
      app.log.error(err);
      return fail(reply, 502, 'Не удалось запустить чат');
    }
  },
);

/** Поллинг лайв-чата (after — последний полученный seq). */
app.get<{ Querystring: { id?: string; after?: string } }>(
  '/api/v1/live/chat/poll',
  async (req, reply): Promise<ChatPollResponse> => {
    const id = (req.query.id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return fail(reply, 400, 'Некорректный id видео');
    const after = req.query.after ? Number(req.query.after) : 0;
    try {
      return reply.send(await pollLiveChat(id, Number.isFinite(after) ? after : 0));
    } catch (err) {
      app.log.error(err);
      return fail(reply, 502, 'Не удалось получить сообщения чата');
    }
  },
);

/* ---------- pairing «Смотреть на ТВ» (Фаза 4) ---------- */

function pairingUrl(req: { headers: { host?: string }; protocol?: string }, code: string): string {
  const host = req.headers.host ?? `localhost:${PORT}`;
  const scheme = req.protocol ?? 'http';
  return `${scheme}://${host}/#/pairing/${code}`;
}

/** Начать сессию: ТВ получает короткий код и ссылку для телефона. */
app.post('/api/v1/pairing/start', async (req, reply): Promise<PairingStartResponse> => {
  const s = pairingCenter.create('');
  s.verificationUrl = pairingUrl(req, s.code);
  return reply.send({
    ok: true,
    code: s.code,
    verificationUrl: s.verificationUrl,
    expiresAt: new Date(s.expiresAt).toISOString(),
    mode: s.mode,
    paired: s.paired,
  });
});

/** Статус сессии (для ТВ и телефона): подключено ли устройство. */
app.get<{ Querystring: { code?: string } }>(
  '/api/v1/pairing/status',
  async (req, reply): Promise<PairingStatusResponse> => {
    const code = (req.query.code ?? '').trim().toUpperCase();
    if (!code) return reply.send({ ok: false, error: 'Параметр code обязателен' });
    const s = pairingCenter.get(code);
    if (!s) return reply.send({ ok: false, error: 'Код не найден или истёк' });
    return reply.send({
      ok: true,
      code: s.code,
      verificationUrl: s.verificationUrl,
      mode: s.mode,
      paired: s.paired,
      deviceName: s.deviceName,
      pendingCommands: s.commands.length,
    });
  },
);

/** Поллинг команд ТВ (телефон → ТВ). */
app.get<{ Querystring: { code?: string } }>(
  '/api/v1/pairing/poll',
  async (req, reply): Promise<PairingPollResponse> => {
    const code = (req.query.code ?? '').trim().toUpperCase();
    if (!code) return reply.send({ ok: false, paired: false, commands: [] });
    const s = pairingCenter.get(code);
    if (!s) return reply.send({ ok: false, paired: false, commands: [], error: 'Код не найден или истёк' });
    const commands = pairingCenter.drain(code);
    return reply.send({ ok: true, paired: s.paired, deviceName: s.deviceName, commands });
  },
);

/** Телефон отправляет команду play на ТВ. */
app.post<{ Body?: PairingSendBody }>(
  '/api/v1/pairing/send',
  async (req, reply): Promise<PairingSendResponse> => {
    const code = (req.body?.code ?? '').trim().toUpperCase();
    if (!code) return reply.send({ ok: false, error: 'Параметр code обязателен' });
    const videoId = parseVideoId(req.body?.videoId ?? '');
    if (!videoId) return reply.send({ ok: false, error: 'Некорректная ссылка или id видео' });
    const s = pairingCenter.get(code);
    if (!s) return reply.send({ ok: false, error: 'Код не найден или истёк' });
    pairingCenter.markPaired(code, req.body?.deviceName?.trim() || 'Телефон');
    pairingCenter.send(code, { kind: 'play', videoId, ts: Date.now() });
    return reply.send({ ok: true });
  },
);

/** Прервать сессию. */
app.post<{ Body?: { code?: string } }>(
  '/api/v1/pairing/disconnect',
  async (req, reply): Promise<{ ok: boolean }> => {
    const code = (req.body?.code ?? '').trim().toUpperCase();
    if (code) pairingCenter.disconnect(code);
    return reply.send({ ok: true });
  },
);

/* ---------- запуск ---------- */

const start = async () => {
  try {
    void tryReachability();
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`SmartTube WEB server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

await start();

export { app };
