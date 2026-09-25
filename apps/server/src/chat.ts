import type {
  ChatAuthor,
  ChatPollResponse,
  LiveChatMessageItem,
  LiveChatResponse,
} from '@stfw/shared';
import { getDefaultSession } from './yt.js';

/**
 * Лайв-чат: держим по одному инстансу youtubei.js `LiveChat` на видео,
 * копим события в буфер с монотонным счётчиком, веб поллит через
 * /api/v1/live/chat/poll?id=&after=.
 */

const MAX_EVENTS = 300;
const BOX_TTL_MS = 30 * 60 * 1000;

interface ChatEvent {
  seq: number;
  item: LiveChatMessageItem;
}

interface ChatBox {
  videoId: string;
  isReplay?: boolean;
  events: ChatEvent[];
  seq: number;
  livechat: LiveChatLike;
  lastActivity: number;
}

/** Структурный тип LiveChat-инстанса youtubei.js (избегаем хрупких импортов). */
type LiveChatLike = {
  is_replay?: boolean;
  on: (event: string, listener: (action?: unknown) => void) => void;
  start: () => void;
  stop?: () => void;
};

const boxes = new Map<string, ChatBox>();

/** Разбор узла из действия chat-update (AddChatItemAction). */
export function parseChatItem(item: unknown): LiveChatMessageItem | null {
  const node = item as {
    type?: string;
    id?: string;
    timestamp?: number;
    timestamp_usec?: number;
    message?: unknown;
    header_subtext?: unknown;
    purchase_amount_text?: unknown;
    author?: {
      name?: string;
      avatar_thumbnail_url?: string;
      thumbnails?: { url?: string }[];
      is_creator?: boolean;
      is_moderator?: boolean;
      is_verified?: boolean;
      is_verified_artist?: boolean;
    };
  };
  if (!node || typeof node.type !== 'string') return null;

  const asText = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof (v as { toString?: unknown }).toString === 'function') {
      const s = (v as { toString: () => unknown }).toString();
      if (typeof s === 'string' && s !== 'undefined') return s;
    }
    return '';
  };

  const type = node.type;
  let kind: LiveChatMessageItem['kind'] = 'other';
  if (type === 'LiveChatTextMessage') kind = 'text';
  else if (type === 'LiveChatPaidMessage') kind = 'paid';
  else if (type.startsWith('LiveChatMembership')) kind = 'membership';

  const author: ChatAuthor = {
    name: node.author?.name ?? '???',
    avatarUrl: node.author?.avatar_thumbnail_url ?? node.author?.thumbnails?.[0]?.url,
    isModerator: node.author?.is_moderator,
    isVerified: node.author?.is_verified ?? node.author?.is_verified_artist,
    isOwner: node.author?.is_creator,
  };

  const text =
    asText(node.message) ||
    asText(node.header_subtext) ||
    (kind === 'paid' ? asText(node.purchase_amount_text) : '');

  if (!text.trim()) return null;

  return {
    id: node.id ?? `${type}:${node.timestamp_usec ?? Date.now()}`,
    author,
    text,
    timestamp: node.timestamp ?? Math.floor((node.timestamp_usec ?? Date.now()) / 1000),
    kind,
  };
}

function handleChatUpdate(box: ChatBox, action: unknown): void {
  const addAction = action as { item?: unknown } | null | undefined;
  const item = addAction?.item;
  const parsed = parseChatItem(item);
  if (!parsed) return;
  box.seq += 1;
  box.events.push({ seq: box.seq, item: parsed });
  if (box.events.length > MAX_EVENTS) box.events.splice(0, box.events.length - MAX_EVENTS);
  box.lastActivity = Date.now();
}

function snapshot(box: ChatBox): LiveChatResponse {
  return {
    available: true,
    videoId: box.videoId,
    isReplay: box.isReplay,
    after: box.seq,
    messages: box.events.map((e) => e.item),
  };
}

function emptyResponse(videoId: string, error?: string): LiveChatResponse {
  return {
    available: false,
    videoId,
    isReplay: undefined,
    after: 0,
    messages: [],
    ...(error ? { error } : {}),
  };
}

/** Создать (или вернуть существующую) сессию чата для видео. */
export async function startLiveChat(videoId: string): Promise<LiveChatResponse> {
  const existing = boxes.get(videoId);
  if (existing && Date.now() - existing.lastActivity < BOX_TTL_MS) return snapshot(existing);

  const yt = await getDefaultSession();
  if (!yt) return emptyResponse(videoId, 'YouTube is not reachable');

  try {
    const info = await yt.getInfo(videoId);
    const livechat = info.livechat as unknown as LiveChatLike | null;
    if (!livechat) return emptyResponse(videoId, 'Чат недоступен для этого видео');

    const box: ChatBox = {
      videoId,
      isReplay: livechat.is_replay,
      events: [],
      seq: 0,
      livechat,
      lastActivity: Date.now(),
    };

    livechat.on('chat-update', (action) => handleChatUpdate(box, action));
    livechat.on('end', () => {
      box.lastActivity = Date.now() - BOX_TTL_MS; // помечаем «протухшим»
    });
    livechat.start();

    boxes.set(videoId, box);
    return snapshot(box);
  } catch (err) {
    return emptyResponse(videoId, `Чат недоступен: ${err instanceof Error ? err.message : 'error'}`);
  }
}

/** Поллинг новых сообщений (after — последний полученный клиентом seq). */
export async function pollLiveChat(videoId: string, after: number): Promise<ChatPollResponse> {
  let box = boxes.get(videoId);
  if (!box || Date.now() - box.lastActivity >= BOX_TTL_MS) {
    await startLiveChat(videoId);
    box = boxes.get(videoId);
  }
  if (!box) return { messages: [], after: 0 };
  const messages = box.events.filter((e) => e.seq > after).map((e) => e.item);
  return { messages, after: box.seq };
}

/* Периодическая уборка умерших комнат. */
setInterval(() => {
  const now = Date.now();
  for (const [id, box] of boxes) {
    if (now - box.lastActivity > BOX_TTL_MS) {
      try {
        box.livechat.stop?.();
      } catch {
        /* ignore */
      }
      boxes.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();