import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceFlowResponse, FavoriteItem } from '@stfw/shared';
import {
  clearFavorites,
  fetchAuthStatus,
  fetchFavorites,
  logoutAccount,
  pollDeviceAuth,
  removeFavorite,
  startDeviceFlow,
} from '../api';
import { useApp } from '../store';
import { useInitialFocus, useTvNavigation } from '../tvnav';

export function AccountPage() {
  const account = useApp((s) => s.account);
  const setAccount = useApp((s) => s.setAccount);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef);

  const applyDevice = useCallback(
    (d: DeviceFlowResponse) => {
      if (d.status === 'signed_in') {
        setAccount({ signedIn: true, channel: d.channel ?? null, flowPending: null, checked: true });
        setError(null);
      } else if (d.status === 'pending') {
        setAccount({ signedIn: false, channel: null, flowPending: d.pending ?? null, checked: true });
        setError(null);
      } else {
        setAccount({ signedIn: false, channel: null, flowPending: null, checked: true });
        setError(d.message ?? 'Не удалось начать вход');
      }
    },
    [setAccount],
  );

  useEffect(() => {
    if (account.checked) return;
    fetchAuthStatus()
      .then((st) => setAccount({ signedIn: st.signedIn, channel: st.channel ?? null, flowPending: st.pending ?? null, checked: true }))
      .catch((e: Error) => setError(e.message));
  }, [account.checked, setAccount]);

  // поллинг входа, пока ждём подтверждения на устройстве
  useEffect(() => {
    if (!account.flowPending) return;
    const t = setInterval(() => {
      pollDeviceAuth()
        .then(applyDevice)
        .catch((e: Error) => setError(e.message));
    }, 5000);
    return () => clearInterval(t);
  }, [account.flowPending, applyDevice]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const d = await startDeviceFlow();
      applyDevice(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const doLogout = async () => {
    try {
      await logoutAccount();
      setAccount({ signedIn: false, channel: null, flowPending: null, checked: true });
      setFavorites([]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (!account.signedIn) {
      setFavorites([]);
      return;
    }
    fetchFavorites()
      .then((r) => setFavorites(r.items))
      .catch(() => setFavorites([]));
  }, [account.signedIn]);

  const removeFav = async (id: string) => {
    try {
      setFavorites((await removeFavorite(id)).items);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const clearAll = async () => {
    try {
      setFavorites((await clearFavorites()).items);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copyCode = async () => {
    if (!account.flowPending) return;
    try {
      await navigator.clipboard.writeText(account.flowPending.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* буфер обмена может быть недоступен */
    }
  };

  const pending = account.flowPending;

  return (
    <div ref={containerRef} className="mx-auto flex max-w-2xl flex-col gap-3 px-3 py-4 sm:px-4">
      <h1 className="px-1 text-2xl font-semibold">Аккаунт</h1>

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm" data-testid="account-error">
          {error}
        </div>
      ) : null}

      {!account.signedIn ? (
        <div className="rounded-xl bg-[#181818] p-5">
          {!pending ? (
            <>
              <p className="mb-3 text-sm text-white/70">
                Вход через аккаунт Google (OAuth device flow): на телефоне/компьютере достаточно один
                раз ввести код на странице подтверждения.
              </p>
              <button
                type="button"
                data-focus
                data-testid="account-start"
                className="rounded-full bg-sky-600 px-5 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
                disabled={starting}
                onClick={start}
              >
                {starting ? 'Запрашиваем код…' : 'Войти через YouTube'}
              </button>
            </>
          ) : (
            <div data-testid="account-flow" className="flex flex-col gap-3">
              <div className="text-sm text-white/70">
                <span className="text-white/50">Шаг 1.</span> Откройте{' '}
                <a
                  className="text-sky-400 underline"
                  href={pending.verificationUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="account-verify"
                >
                  youtube.com/activate
                </a>
              </div>
              <div className="text-sm text-white/70">
                <span className="text-white/50">Шаг 2.</span> Введите код и подтвердите вход. Страница
                обновится автоматически.
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-testid="account-code"
                  className="rounded-xl bg-black/40 px-6 py-3 font-mono text-3xl tracking-[0.3em] text-sky-300"
                >
                  {pending.userCode}
                </span>
                <button
                  type="button"
                  data-focus
                  data-testid="account-copy"
                  className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
                  onClick={copyCode}
                >
                  {copied ? 'Скопировано ✓' : 'Скопировать'}
                </button>
              </div>
              <div className="text-xs text-white/40" data-testid="account-poll-status">
                Ждём подтверждения… (проверка каждые ~5 сек)
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-[#181818] p-5">
          <div className="flex items-center gap-4">
            {account.channel?.avatarUrl ? (
              <img
                src={account.channel.avatarUrl}
                alt=""
                data-testid="account-avatar"
                className="h-16 w-16 rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-[#0f0f0f]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold" data-testid="account-name">
                {account.channel?.name ?? 'Аккаунт'}
              </div>
              {account.channel?.id ? (
                <div className="text-xs text-white/40">{account.channel.id}</div>
              ) : null}
            </div>
            <button
              type="button"
              data-focus
              data-testid="account-logout"
              className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
              onClick={doLogout}
            >
              Выйти
            </button>
          </div>
        </div>
      )}

      {account.signedIn ? (
        <div className="rounded-xl bg-[#181818] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold" data-testid="favorites-title">
              Избранное
            </h2>
            {favorites.length > 0 ? (
              <button
                type="button"
                data-focus
                data-testid="favorites-clear"
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
                onClick={clearAll}
              >
                Очистить
              </button>
            ) : null}
          </div>
          {favorites.length === 0 ? (
            <p className="text-sm text-white/40">
              Пусто. Нажимайте «В избранное» на странице видео.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {favorites.map((f) => (
                <li
                  key={f.id}
                  data-testid="favorite-item"
                  className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm">{f.title}</div>
                    {f.authorName ? (
                      <div className="text-xs text-white/40">{f.authorName}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      data-focus
                      data-testid="favorite-remove"
                      className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-red-500/40"
                      onClick={() => removeFav(f.id)}
                    >
                      Убрать
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}