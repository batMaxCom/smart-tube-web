import { useEffect, useRef } from 'react';
import type { ChannelTab } from '@stfw/shared';
import { fetchAuthStatus } from './api';
import { useApp, type Route } from './store';
import { Header } from './components/Header';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { PlayerPage } from './pages/PlayerPage';
import { ChannelPage } from './pages/ChannelPage';
import { PlaylistPage } from './pages/PlaylistPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { LivePage } from './pages/LivePage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { AccountPage } from './pages/AccountPage';
import { PairingPage } from './pages/PairingPage';
import { useServiceWorkerUpdate } from './sw';

const TABS: ChannelTab[] = ['home', 'videos', 'shorts', 'live', 'playlists', 'podcasts', 'releases'];

function routeToHash(route: Route): string {
  switch (route.name) {
    case 'search':
      return `#/search/${encodeURIComponent(route.query ?? '')}`;
    case 'watch':
      return `#/watch/${encodeURIComponent(route.id ?? '')}`;
    case 'channel':
      return `#/channel/${encodeURIComponent(route.id)}${route.tab && route.tab !== 'videos' ? `/${route.tab}` : ''}`;
    case 'playlist':
      return `#/playlist/${encodeURIComponent(route.id)}`;
    case 'subscriptions':
      return '#/subscriptions';
    case 'live':
      return '#/live';
    case 'history':
      return '#/history';
    case 'settings':
      return '#/settings';
    case 'account':
      return '#/account';
    case 'pairing':
      return route.target ? `#/pairing/${encodeURIComponent(route.target)}` : '#/pairing';
    default:
      return '#/';
  }
}

function hashToRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [section, param, sub] = clean.split('/');
  if (section === 'search') return { name: 'search', query: param ? decodeURIComponent(param) : '' };
  if (section === 'watch') return { name: 'watch', id: decodeURIComponent(param ?? '') };
  if (section === 'channel') {
    const tab = (TABS as string[]).includes(sub as string) ? (sub as ChannelTab) : 'videos';
    return { name: 'channel', id: decodeURIComponent(param ?? ''), tab };
  }
  if (section === 'playlist') return { name: 'playlist', id: decodeURIComponent(param ?? '') };
  if (section === 'subscriptions') return { name: 'subscriptions' };
  if (section === 'live') return { name: 'live' };
  if (section === 'history') return { name: 'history' };
  if (section === 'settings') return { name: 'settings' };
  if (section === 'account') return { name: 'account' };
  if (section === 'pairing') {
    const target = param ? decodeURIComponent(param) : undefined;
    return target ? { name: 'pairing', target } : { name: 'pairing' };
  }
  return { name: 'home' };
}

export function App() {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const theme = useApp((s) => s.settings.theme);
  const setAccount = useApp((s) => s.setAccount);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstHashSync = useRef(true);
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate();

  // глобальная загрузка статуса аккаунта (для лайков, подписок в любом месте)
  useEffect(() => {
    let cancelled = false;
    fetchAuthStatus()
      .then((st) => {
        if (!cancelled) {
          setAccount({ signedIn: st.signedIn, channel: st.channel ?? null, flowPending: st.pending ?? null, checked: true });
        }
      })
      .catch(() => !cancelled && setAccount({ signedIn: false, channel: null, flowPending: null, checked: true }));
    return () => {
      cancelled = true;
    };
  }, [setAccount]);

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }, [theme]);

  // хэш-роутинг: синхронизация state ↔ URL
  useEffect(() => {
    const onHash = () => {
      navigate(hashToRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Первый рендер не перетирает глубокую ссылку (например, прямое открытие #/search)
  useEffect(() => {
    if (firstHashSync.current) {
      firstHashSync.current = false;
      return;
    }
    if (route) {
      const target = routeToHash(route);
      if (window.location.hash !== target) window.location.hash = target;
    }
  }, [route]);

  return (
    <div ref={rootRef} className="safe-bottom min-h-screen">
      <Header />
      {route.name === 'home' && <HomePage />}
      {route.name === 'search' && <SearchPage key={`search-${route.query}`} initialQuery={route.query ?? ''} />}
      {route.name === 'watch' && <PlayerPage key={`watch-${route.id}`} id={route.id ?? ''} />}
      {route.name === 'channel' && (
        <ChannelPage key={`channel-${route.id}-${route.tab ?? 'videos'}`} id={route.id} tab={route.tab ?? 'videos'} />
      )}
      {route.name === 'playlist' && <PlaylistPage key={`playlist-${route.id}`} id={route.id} />}
      {route.name === 'subscriptions' && <SubscriptionsPage />}
      {route.name === 'live' && <LivePage />}
      {route.name === 'history' && <HistoryPage />}
      {route.name === 'settings' && <SettingsPage />}
      {route.name === 'account' && <AccountPage />}
      {route.name === 'pairing' && <PairingPage key={`pairing-${route.target ?? ''}`} target={route.target} />}
      {updateAvailable && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg bg-[#1f1f1f] border border-[#333] px-4 py-3 shadow-xl" data-testid="sw-update-banner">
          <span className="text-sm">Доступно обновление приложения</span>
          <button
            className="rounded bg-[#e62117] px-3 py-1.5 text-sm font-medium text-white"
            onClick={applyUpdate}
            data-testid="sw-update-apply"
          >
            Перезапустить
          </button>
        </div>
      )}
    </div>
  );
}