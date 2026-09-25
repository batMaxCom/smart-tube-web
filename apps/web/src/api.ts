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
  FavoriteItem,
  FavoritesResponse,
  FeedSource,
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

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(parsed?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function withGl(url: string, gl?: string): string {
  if (!gl) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}gl=${encodeURIComponent(gl)}`;
}

export function fetchBrowse(gl?: string): Promise<BrowseResponse> {
  return get(withGl('/api/v1/browse', gl));
}

export function fetchSearch(q: string, gl?: string): Promise<SearchResponse> {
  return get(withGl(`/api/v1/search?q=${encodeURIComponent(q)}`, gl));
}

export function fetchPlayer(id: string): Promise<PlayerResponse> {
  return get(`/api/v1/player?id=${encodeURIComponent(id)}`);
}

export function fetchChannel(id: string, tab: ChannelTab, gl?: string): Promise<ChannelResponse> {
  return get(withGl(`/api/v1/channel?id=${encodeURIComponent(id)}&tab=${tab}`, gl));
}

export function fetchPlaylist(id: string, gl?: string): Promise<PlaylistResponse> {
  return get(withGl(`/api/v1/playlist?id=${encodeURIComponent(id)}`, gl));
}

export function fetchNext(src: FeedSource, token: string): Promise<NextResponse> {
  return get(`/api/v1/next?src=${encodeURIComponent(src)}&token=${encodeURIComponent(token)}`);
}

export function fetchLive(gl?: string): Promise<SearchResponse> {
  return get(withGl('/api/v1/live', gl));
}

export function fetchSubscriptions(gl?: string): Promise<SearchResponse> {
  return get(withGl('/api/v1/subscriptions', gl));
}

export function fetchComments(videoId: string, gl?: string): Promise<CommentsResponse> {
  return get(withGl(`/api/v1/comments?id=${encodeURIComponent(videoId)}`, gl));
}

export function fetchCommentsNext(token: string): Promise<CommentsResponse> {
  return get(`/api/v1/next?src=comments&token=${encodeURIComponent(token)}`);
}

export const PLAYER_RATES: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function fetchRelated(videoId: string, gl?: string): Promise<RelatedResponse> {
  return get(withGl(`/api/v1/related?id=${encodeURIComponent(videoId)}`, gl));
}

/* ================== аккаунт (Фаза 3) ================== */

export function fetchAuthStatus(): Promise<AuthStatus> {
  return get('/api/v1/auth/status');
}

export function startDeviceFlow(): Promise<DeviceFlowResponse> {
  return post('/api/v1/auth/device');
}

export function pollDeviceAuth(): Promise<DeviceFlowResponse> {
  return get('/api/v1/auth/poll');
}

export function logoutAccount(): Promise<{ ok: boolean }> {
  return post('/api/v1/auth/logout');
}

export function engage(body: EngagementBody): Promise<EngagementResult> {
  return post('/api/v1/engagement', body);
}

export function fetchAccountHistory(): Promise<HistoryResponse> {
  return get('/api/v1/history');
}

/* ---------- избранное ---------- */

export function fetchFavorites(): Promise<FavoritesResponse> {
  return get('/api/v1/favorites');
}

export function addFavorite(item: Pick<FavoriteItem, 'id' | 'title' | 'authorName'>): Promise<FavoritesResponse> {
  return post('/api/v1/favorites', item);
}

export function removeFavorite(id: string): Promise<FavoritesResponse> {
  return post('/api/v1/favorites/remove', { id });
}

export function clearFavorites(): Promise<FavoritesResponse> {
  return post('/api/v1/favorites/clear');
}

/* ---------- бэкап / синхронизация ---------- */

export function backupSave(code: string | undefined, data: Record<string, unknown>): Promise<BackupResult> {
  return post('/api/v1/backup', { code, data });
}

export function backupGet(code: string): Promise<BackupDocument> {
  return get(`/api/v1/backup/${encodeURIComponent(code)}`);
}

/* ---------- лайв-чат ---------- */

export function chatStart(videoId: string): Promise<LiveChatResponse> {
  return get(`/api/v1/live/chat?id=${encodeURIComponent(videoId)}`);
}

export function chatPoll(videoId: string, after: number): Promise<ChatPollResponse> {
  return get(`/api/v1/live/chat/poll?id=${encodeURIComponent(videoId)}&after=${after}`);
}

/* ---------- pairing «Смотреть на ТВ» (Фаза 4) ---------- */

export function pairingStart(): Promise<PairingStartResponse> {
  return post('/api/v1/pairing/start');
}

export function pairingStatus(code: string): Promise<PairingStatusResponse> {
  return get(`/api/v1/pairing/status?code=${encodeURIComponent(code)}`);
}

export function pairingPoll(code: string): Promise<PairingPollResponse> {
  return get(`/api/v1/pairing/poll?code=${encodeURIComponent(code)}`);
}

export function pairingSend(body: PairingSendBody): Promise<PairingSendResponse> {
  return post('/api/v1/pairing/send', body);
}

export function pairingDisconnect(): Promise<{ ok: boolean }> {
  return post('/api/v1/pairing/disconnect');
}

export interface ManifestParams {
  codec: VideoCodec;
  maxHeight?: string;
}

export function manifestUrl(id: string, params?: ManifestParams): string {
  const sp = new URLSearchParams();
  if (params) {
    sp.set('codec', params.codec);
    if (params.maxHeight) sp.set('maxHeight', params.maxHeight);
  }
  const qs = sp.toString();
  return `${BASE}/api/v1/manifest/${encodeURIComponent(id)}.mpd${qs ? `?${qs}` : ''}`;
}

export function formatViews(n?: number): string {
  if (n === undefined || n === null) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.0', '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export interface ThumbLike {
  url: string;
  width?: number;
  height?: number;
}

export function bestThumb(v: { thumbnails?: ThumbLike[] } | undefined): string | undefined {
  const list = v?.thumbnails ?? [];
  return (
    [...list]
      .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))
      .find((t) => (t.width ?? 0) >= 320)?.url ?? list[0]?.url
  );
}