import { useState } from 'react';
import { useApp } from '../store';
import { useT } from '../i18n/useT';
import { exitToMsx, isMsxMode } from '../msx';

const NAV = [
  { route: { name: 'live' }, labelKey: 'nav.live', testid: 'nav-live' },
  { route: { name: 'subscriptions' }, labelKey: 'nav.subs', testid: 'nav-subs' },
  { route: { name: 'history' }, labelKey: 'nav.history', testid: 'nav-history' },
  { route: { name: 'pairing' }, labelKey: 'nav.pairing', testid: 'nav-pairing' },
  { route: { name: 'settings' }, labelKey: 'nav.settings', testid: 'nav-settings' },
] as const;

export function Header() {
  const t = useT();
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const goBack = useApp((s) => s.goBack);
  const signedIn = useApp((s) => s.account.signedIn);
  const channel = useApp((s) => s.account.channel);
  const [msx] = useState(isMsxMode);

  const accountLabel = signedIn
    ? (channel?.name ?? t('nav.account')).trim().charAt(0).toUpperCase()
    : t('nav.signin');

  return (
    <header className="safe-top sticky top-0 z-20 flex items-center gap-2 border-b border-white/10 bg-[#0f0f0f]/95 px-3 pb-2 backdrop-blur sm:gap-3 sm:px-4 sm:pb-3">
      <button
        type="button"
        aria-label={t('common.back')}
        className="shrink-0 rounded-full border border-transparent px-3 py-1 text-lg text-white/80 hover:text-white"
        onClick={() => (route.name === 'home' ? null : goBack())}
      >
        ←
      </button>
      <button
        type="button"
        data-focus
        className="shrink-0 font-bold tracking-tight"
        data-testid="logo"
        onClick={() => navigate({ name: 'home' })}
      >
        SmartTube <span className="font-normal text-white/40">WEB</span>
      </button>
      {/* На узких экранах навигация прокручивается вбок, чтобы не выдавливать логотип */}
      <nav className="no-scrollbar ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2">
        <span className="hidden shrink-0 text-xs text-white/40 lg:block">TV-first</span>
        {NAV.map((n) => (
          <button
            key={n.testid}
            type="button"
            data-focus
            data-testid={n.testid}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm hover:bg-white/15 ${
              route.name === n.route.name ? 'bg-white/15' : ''
            }`}
            onClick={() => navigate({ ...(n.route as { name: 'live' | 'subscriptions' | 'history' | 'pairing' | 'settings' }) })}
          >
            {t(n.labelKey)}
          </button>
        ))}
        {msx ? (
          <button
            type="button"
            data-focus
            data-testid="btn-exit-msx"
            className="shrink-0 whitespace-nowrap rounded-full bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
            onClick={exitToMsx}
          >
            {t('msx.exit')}
          </button>
        ) : null}
        <button
          type="button"
          data-focus
          className="shrink-0 whitespace-nowrap rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20"
          data-testid="search-btn"
          onClick={() => navigate({ name: 'search', query: '' })}
        >
          {t('nav.search')}
        </button>
        <button
          type="button"
          data-focus
          className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm hover:bg-white/15 ${
            route.name === 'account' ? 'bg-white/15' : 'bg-white/10'
          }`}
          data-testid="nav-account"
          onClick={() => navigate({ name: 'account' })}
        >
          {accountLabel}
        </button>
      </nav>
    </header>
  );
}
