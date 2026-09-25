/** Толщина (разрешение) для отрисовки карточки. */
export type ThumbnailQuality = 'default' | 'medium' | 'high' | 'standard' | 'maxres';

export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

export interface ChannelRef {
  id?: string;
  name: string;
}

/** Канал как объект карточки/шапки канальной страницы. */
export interface ChannelInfo {
  id: string;
  name: string;
  handle?: string;
  thumbnails: Thumbnail[];
  banner?: Thumbnail[];
  subscriberCount?: number;
  videoCount?: number;
  description?: string;
}

/** Плейлист как карточка. */
export interface PlaylistInfo {
  id: string;
  title: string;
  author?: ChannelRef;
  thumbnails: Thumbnail[];
  videoCount?: number;
}

/** Универсальный элемент ленты (грид/полка/поиск/продолжение). */
export type FeedItem =
  | { type: 'video'; video: Video }
  | { type: 'channel'; channel: ChannelInfo }
  | { type: 'playlist'; playlist: PlaylistInfo };

/** Строка/секция ленты. */
export interface FeedRow {
  title?: string;
  items: FeedItem[];
}

export type FeedSource = 'browse' | 'search' | 'channel' | 'playlist' | 'live' | 'subscriptions' | 'related' | 'comments';

/** Имя вкладки канальной страницы (youtubei.js: getVideos/getShorts/...). */
export type ChannelTab = 'home' | 'videos' | 'shorts' | 'live' | 'playlists' | 'podcasts' | 'releases';

export interface ChannelTabInfo {
  id: ChannelTab;
  title: string;
}

/** Видео в ленте/поиске/плеере. */
export interface Video {
  id: string;
  title: string;
  author: ChannelRef;
  durationSeconds: number;
  viewCount?: number;
  published?: string;
  description?: string;
  thumbnails: Thumbnail[];
  isLive?: boolean;
  isUpcoming?: boolean;
}

/** Группа карточек (секция главной ленты). */
export interface BrowseResponse {
  sections: FeedRow[];
  continuation?: string;
}

export interface SearchResponse {
  items: FeedItem[];
  continuation?: string;
}

export interface ChannelResponse {
  channel: ChannelInfo;
  tabs: ChannelTabInfo[];
  items: FeedItem[];
  continuation?: string;
  /** true — контент канала недоступен без логина (возрастные/подписочные ограничения). */
  restricted?: boolean;
}

export interface PlaylistResponse {
  playlist: PlaylistInfo;
  items: FeedItem[];
  continuation?: string;
}

/** Ответ общего endpoint'а продолжения (бесконечный скролл). */
export interface NextResponse {
  items: FeedItem[];
  continuation?: string;
}

export type PlayabilityStatus =
  'ok' | 'login_required' | 'unavailable' | 'blocked' | 'age_restricted';

/** Кодечная группа потока. */
export type VideoCodec = 'avc' | 'vp9' | 'av01';
export type AudioCodec = 'opus' | 'aac' | 'vorbis' | 'mp4a' | 'unknown';

/** HDR-флаг для UI. */
export interface ColorInfo {
  isHdr: boolean;
  primaries?: string;
  transferCharacteristics?: string;
}

/** Один поток в плеере (video-only или audio-only или muxed). */
export interface VideoFormat {
  /** youtube itag */
  itag: number;
  /** прямой URL потока (если не DRM) */
  url?: string;
  mimeType: string; // e.g. video/mp4
  codecs: VideoCodec | AudioCodec;
  /** true для видео-потоков */
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  audioBitrate?: number;
  audioSampleRate?: number;
  audioChannels?: number;
  colorInfo?: ColorInfo;
  contentLength?: number;
  initRange?: { start: number; end: number };
  indexRange?: { start: number; end: number };
  /** защищённый DRM (нет url, нужен EME) */
  isProtected?: boolean;
  /** наименование из itag для UI (например "1080p60") */
  label?: string;
  /** mime codecs строка как в youtube (vp09.00.50.08...) */
  codecsString?: string;
}

export interface PlayerResponse {
  id: string;
  title: string;
  description?: string;
  author: ChannelRef;
  durationSeconds: number;
  thumbnails: Thumbnail[];
  playability: PlayabilityStatus;
  playabilityReason?: string;
  viewCount?: number;
  likeCount?: number;
  isLive?: boolean;
  formats: VideoFormat[];
  /** Сформированный каталог MPD, который отдаёт сервер. */
  manifestPath?: string;
  /** true — если live-потоки недоступны с IP сервера и включён демо-режим. */
  demo?: boolean;
}

/** Рекомендации («смотреть далее» / «похожие») для страницы плеера. */
export interface RelatedResponse {
  items: FeedItem[];
  continuation?: string;
  /** Видео, которое бы запустилось следом автоматически. */
  upNext?: Video;
}

/** Комментарий. */
export interface CommentInfo {
  id: string;
  author: { id?: string; name: string };
  avatarUrl?: string;
  content: string;
  publishedTime?: string;
  likeCount?: string;
  replyCount?: number;
  isPinned?: boolean;
  /** Содержит ли тред ещё ответы (для единичного показа количества). */
  hasReplies?: boolean;
}

export interface CommentsResponse {
  comments: CommentInfo[];
  continuation?: string;
}

export type DemoMode = 'auto' | 'on' | 'off';

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptime: number;
  /** true, если сервер считает, что YouTube сейчас доступен с его IP. */
  youtubeReachable: boolean;
  /** Режим демо-контента: 'auto' — по детекту, 'on' — всегда демо, 'off' — никогда. */
  demoMode: DemoMode;
}

/* ================== аккаунт (Фаза 3) ================== */

/** Канал (профиль) залогиненного аккаунта. */
export interface AuthChannel {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface AuthStatus {
  signedIn: boolean;
  channel?: AuthChannel;
  /** Идёт ли сейчас вход: код уже выдан, осталось подтвердить на устройстве. */
  pending?: {
    userCode: string;
    verificationUrl: string;
    interval: number;
    /** ISO когда истекает device_code. */
    expiresAt: string;
  } | null;
}

export type DeviceFlowStatus = 'signed_in' | 'pending' | 'error';

export interface DeviceFlowResponse extends AuthStatus {
  status: DeviceFlowStatus;
  message?: string;
}

export interface EngagementResult {
  ok: boolean;
  reason?: 'login_required';
}

/* ================== избранное / бэкап / лайв-чат (Фаза 3) ================== */

export interface FavoriteItem {
  id: string;
  title: string;
  authorName?: string;
  addedAt: number;
}

export interface FavoritesResponse {
  items: FavoriteItem[];
}

export interface BackupDocument {
  kind: 'stfw-backup';
  version: 1;
  savedAt: number;
  /** Данные для восстановления (настройки, история и т.п.). */
  data: Record<string, unknown>;
}

export interface BackupResult {
  ok: boolean;
  code?: string;
  error?: string;
}

export interface ChatAuthor {
  name: string;
  avatarUrl?: string;
  isModerator?: boolean;
  isVerified?: boolean;
  isOwner?: boolean;
}

export interface LiveChatMessageItem {
  id: string;
  author: ChatAuthor;
  text: string;
  timestamp: number;
  kind: 'text' | 'paid' | 'membership' | 'other';
}

export interface LiveChatResponse {
  available: boolean;
  videoId: string;
  isReplay?: boolean;
  /** Монотонно растущий счётчик последнего сообщения (для poll). */
  after: number;
  messages: LiveChatMessageItem[];
  error?: string;
}

export interface ChatPollResponse {
  messages: LiveChatMessageItem[];
  after: number;
}

export interface EngagementBody {
  videoId?: string;
  channelId?: string;
  action?: 'like' | 'dislike' | 'none' | 'sub' | 'unsub';
}

export interface HistoryResponse {
  items: FeedItem[];
}

/* ================== pairing «Смотреть на ТВ» (Фаза 4) ================== */

/** Как связан пульт (телефон) с ТВ: наш command-channel или реальный YouTube lounge. */
export type PairingMode = 'local' | 'youtube';

export interface PairingCommand {
  kind: 'play';
  videoId: string;
  ts: number;
}

export interface PairingStartResponse {
  ok: boolean;
  code?: string;
  verificationUrl?: string;
  /** ISO когда истекает код. */
  expiresAt?: string;
  mode?: PairingMode;
  paired?: boolean;
  error?: string;
}

export interface PairingStatusResponse {
  ok: boolean;
  code?: string;
  verificationUrl?: string;
  mode?: PairingMode;
  paired?: boolean;
  deviceName?: string;
  /** Очередь неотправленных на ТВ команд. */
  pendingCommands?: number;
  error?: string;
}

export interface PairingPollResponse {
  ok: boolean;
  paired: boolean;
  deviceName?: string;
  commands: PairingCommand[];
  error?: string;
}

export interface PairingSendBody {
  code?: string;
  videoId?: string;
  /** Название телефона/устройства, которое привязывается к ТВ. */
  deviceName?: string;
}

export interface PairingSendResponse {
  ok: boolean;
  error?: string;
}
