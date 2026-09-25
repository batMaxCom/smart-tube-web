import type {
  AuthChannel,
  AuthStatus,
  DeviceFlowResponse,
  EngagementBody,
  EngagementResult,
} from '@stfw/shared';
import type { DeviceAndUserCode, Innertube, OAuth2Tokens } from 'youtubei.js';
import { clearTokens, loadTokens, saveTokens } from './creds.js';
import { getDefaultSession } from './yt.js';

/**
 * Логин через OAuth2 device-flow (как SmartTube).
 *
 * youtubei.js сам умеет весь цикл: `session.oauth.init()` без токенов
 * запрашивает device/user code, эмитит 'auth-pending', затем внутренним
 * интервалом поллит токены и эмитит 'auth' с credentials. Мы лишь
 * слушаем события, сохраняем токены на диск и отдаём состояние наружу.
 */

interface PendingInfo {
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresAt: string;
}

type FlowState =
  | { status: 'idle' }
  | { status: 'pending'; pending: PendingInfo }
  | { status: 'error'; message: string };

let flow: FlowState = { status: 'idle' };

/** Привязываем слушатели к конкретной сессии один раз. */
const attached = new WeakSet<object>();

function attachOauthListeners(yt: Innertube): void {
  if (attached.has(yt.session)) return;
  attached.add(yt.session);

  yt.session.on('auth-pending', (code: DeviceAndUserCode) => {
    flow = {
      status: 'pending',
      pending: {
        userCode: code.user_code,
        verificationUrl: code.verification_url,
        interval: code.interval,
        expiresAt: new Date(Date.now() + (code.expires_in ?? 600) * 1000).toISOString(),
      },
    };
  });

  yt.session.on('auth', ({ credentials }: { credentials?: OAuth2Tokens }) => {
    if (!credentials) return;
    flow = { status: 'idle' };
    void saveTokens(credentials).catch((err) => {
      console.error('[auth] failed to persist credentials:', err);
    });
  });

  yt.session.on('auth-error', (err: Error) => {
    flow = { status: 'error', message: err?.message ?? 'OAuth error' };
  });
}

/** Залогинены ли мы (токены есть на диске и/или сессия уже авторизована). */
export async function hasCredentials(): Promise<boolean> {
  return (await loadTokens()) !== null;
}

/** Профиль активного канала (best-effort: с этого IP может не ответить). */
export async function getAuthChannel(): Promise<AuthChannel | undefined> {
  const yt = await getDefaultSession();
  if (!yt || !yt.session.logged_in) return undefined;
  try {
    const items: Array<{
      is_selected?: boolean;
      account_name?: { text?: string };
      account_photo?: { url?: string }[];
      endpoint?: { payload?: { browseId?: string } };
    }> = (await yt.account.getInfo(true)) as never;
    const sel = items.find((it) => it.is_selected) ?? items[0];
    if (!sel) return undefined;
    const browseId = (sel.endpoint?.payload as { browseId?: string } | undefined)?.browseId;
    return {
      id: browseId ?? '',
      name: sel.account_name?.text ?? 'Аккаунт',
      avatarUrl: sel.account_photo?.[0]?.url,
    };
  } catch (err) {
    console.warn('[auth] getInfo failed:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

function signedInResponse(channel?: AuthChannel): DeviceFlowResponse {
  return { status: 'signed_in', signedIn: true, pending: null, channel };
}

function pendingResponse(p: PendingInfo): DeviceFlowResponse {
  return { status: 'pending', signedIn: false, pending: p };
}

/** Текущий статус авторизации (лёгкий, без сети, кроме getInfo). */
export async function authStatus(): Promise<AuthStatus> {
  if (await hasCredentials()) {
    const channel = await getAuthChannel();
    return { signedIn: true, channel, pending: null };
  }
  return {
    signedIn: false,
    pending: flow.status === 'pending' ? flow.pending : null,
  };
}

/** Запустить (или продолжить) вход по коду устройства. */
export async function startDeviceFlow(): Promise<DeviceFlowResponse> {
  if (await hasCredentials()) {
    return signedInResponse(await getAuthChannel());
  }
  if (flow.status === 'pending') return pendingResponse(flow.pending);

  const yt = await getDefaultSession();
  if (!yt) return { status: 'error', signedIn: false, pending: null, message: 'YouTube is not reachable' };

  attachOauthListeners(yt);
  if (yt.session.logged_in) return signedInResponse(await getAuthChannel());

  try {
    await yt.session.oauth.init();
  } catch (err) {
    flow = { status: 'error', message: err instanceof Error ? err.message : 'Device flow failed' };
    return { status: 'error', signedIn: false, pending: null, message: flow.message };
  }
  const state = flow as FlowState; // 'pending' приходит асинхронным событием
  if (state.status === 'pending') return pendingResponse(state.pending);
  return {
    status: 'error',
    signedIn: false,
    pending: null,
    message: state.status === 'error' ? state.message : 'Failed to obtain device code',
  };
}

/**
 * Поллинг статуса входа. Если сервер перезапускали посреди цикла и код был
 * утерян — «самочинно» начнём заново, чтобы клиент не висел вечно.
 */
export async function pollDeviceAuth(): Promise<DeviceFlowResponse> {
  if (await hasCredentials()) return signedInResponse(await getAuthChannel());
  if (flow.status === 'pending') return pendingResponse(flow.pending);
  if (flow.status === 'error') {
    return { status: 'error', signedIn: false, pending: null, message: flow.message };
  }
  return startDeviceFlow();
}

/** Выход: отзываем токены и стираем их с диска. */
export async function logout(): Promise<void> {
  const yt = await getDefaultSession();
  if (yt?.session.logged_in) {
    try {
      await yt.session.signOut();
    } catch (err) {
      console.warn('[auth] signOut failed:', err instanceof Error ? err.message : err);
    }
  }
  await clearTokens();
  flow = { status: 'idle' };
}

/** Взаимодействия от имени аккаунта (лайк/дизлайк/подписка). */
export async function engage(body: EngagementBody): Promise<EngagementResult> {
  const yt = await getDefaultSession();
  if (!yt) return { ok: false };
  if (!yt.session.logged_in) return { ok: false, reason: 'login_required' };

  const { videoId, channelId, action } = body;
  try {
    switch (action) {
      case 'like':
        if (!videoId) return { ok: false, reason: 'login_required' };
        await yt.interact.like(videoId);
        return { ok: true };
      case 'dislike':
        if (!videoId) return { ok: false, reason: 'login_required' };
        await yt.interact.dislike(videoId);
        return { ok: true };
      case 'none':
        if (!videoId) return { ok: false, reason: 'login_required' };
        await yt.interact.removeRating(videoId);
        return { ok: true };
      case 'sub':
        if (!channelId) return { ok: false, reason: 'login_required' };
        await yt.interact.subscribe(channelId);
        return { ok: true };
      case 'unsub':
        if (!channelId) return { ok: false, reason: 'login_required' };
        await yt.interact.unsubscribe(channelId);
        return { ok: true };
      default:
        return { ok: false, reason: 'login_required' };
    }
  } catch (err) {
    console.warn('[auth] engage failed:', err instanceof Error ? err.message : err);
    return { ok: false };
  }
}