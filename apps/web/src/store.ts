import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AuthChannel, AuthStatus, ChannelTab, VideoCodec } from '@stfw/shared';
import { idbStorage } from './idb';

export type Route =
  | { name: 'home' }
  | { name: 'search'; query: string }
  | { name: 'watch'; id: string }
  | { name: 'channel'; id: string; tab?: ChannelTab }
  | { name: 'playlist'; id: string }
  | { name: 'subscriptions' }
  | { name: 'live' }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'account' }
  | { name: 'pairing'; target?: string };

export type Theme = 'dark' | 'light';
export type Lang = 'ru' | 'en';

export const COUNTRIES = ['US', 'RU', 'UA', 'BY', 'KZ', 'DE', 'GB', 'FR', 'PL', 'AU'] as const;
export type Country = (typeof COUNTRIES)[number];

export interface HistoryEntry {
  id: string;
  title: string;
  ts: number;
}

interface SearchState {
  query: string;
  results: { id: string; title: string }[];
}

/** Транзиентное состояние аккаунта (запрашивается с сервера, не персистится). */
export interface AccountSlice {
  signedIn: boolean;
  channel: AuthChannel | null;
  /** Идёт вход по коду устройства (pending device flow). */
  flowPending: NonNullable<AuthStatus['pending']> | null;
  /** Данные уже подгружены с сервера. */
  checked: boolean;
}

interface Settings {
  codec: VideoCodec;
  /** 0 — без ограничения высоты */
  maxHeight: number;
  theme: Theme;
  lang: Lang;
  /** Страна (gl) для innertube-сессий на сервере. */
  gl: Country;
  /** Автопереход к «следующему» видео по завершении. */
  autoplayNext: boolean;
  /** Фоновый аудио-режим (скрыть видео, Wake Lock: «выключение экрана»). */
  audioMode: boolean;
}

interface AppState {
  route: Route;
  /** Стек «куда вернуться» для Back (в т.ч. channel/playlist/...). */
  backstack: Route[];
  /** Локальная история просмотра (персистится в IndexedDB). */
  history: HistoryEntry[];
  settings: Settings;
  search: SearchState;
  error: string | null;
  busy: boolean;
  account: AccountSlice;
  navigate: (to: Route) => void;
  goBack: () => void;
  pushHistory: (id: string, title: string) => void;
  clearHistory: () => void;
  setError: (e: string | null) => void;
  setBusy: (b: boolean) => void;
  setCodec: (c: VideoCodec) => void;
  setMaxHeight: (h: number) => void;
  setTheme: (t: Theme) => void;
  setLang: (l: Lang) => void;
  setCountry: (c: Country) => void;
  setAutoplayNext: (v: boolean) => void;
  setAudioMode: (v: boolean) => void;
  setSearchResults: (r: SearchState) => void;
  setAccount: (patch: Partial<AccountSlice>) => void;
  /** Восстановление из резервной копии (бэкап по коду). */
  applyBackup: (data: { settings?: Partial<Settings>; history?: HistoryEntry[] }) => void;
}

const DEFAULT_SETTINGS: Settings = {
  codec: 'vp9',
  maxHeight: 0,
  theme: 'dark',
  lang: 'ru',
  gl: 'US',
  autoplayNext: true,
  audioMode: false,
};

function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  switch (a.name) {
    case 'search':
      return b.name === 'search' && a.query === b.query;
    case 'watch':
      return b.name === 'watch' && a.id === b.id;
    case 'channel':
      return b.name === 'channel' && a.id === b.id && a.tab === (b as { tab?: ChannelTab }).tab;
    case 'playlist':
      return b.name === 'playlist' && a.id === b.id;
    case 'pairing':
      return b.name === 'pairing' && a.target === (b as { target?: string }).target;
    default:
      return true;
  }
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      route: { name: 'home' },
      backstack: [],
      history: [],
      settings: DEFAULT_SETTINGS,
      search: { query: '', results: [] },
      error: null,
      busy: false,
      account: { signedIn: false, channel: null, flowPending: null, checked: false },

      navigate: (to) =>
        set((s) => {
          const last = s.backstack[s.backstack.length - 1];
          // hashchange после перехода тоже дергает navigate — не дублируем соседние маршруты
          const backstack = last && sameRoute(last, to) ? s.backstack : [...s.backstack, to].slice(-64);
          return { route: to, backstack };
        }),

      goBack: () => {
        const s = get();
        const back = [...s.backstack];
        back.pop();
        set({
          backstack: back,
          route: back.length ? back[back.length - 1] : { name: 'home' },
        });
      },

      pushHistory: (id, title) =>
        set((s) => ({
          history: [
            { id, title, ts: Date.now() },
            ...s.history.filter((h) => h.id !== id).slice(0, 99),
          ],
        })),

      clearHistory: () => set({ history: [] }),

      setError: (e) => set({ error: e }),
      setBusy: (b) => set({ busy: b }),
      setCodec: (c) => set((s) => ({ settings: { ...s.settings, codec: c } })),
      setMaxHeight: (h) => set((s) => ({ settings: { ...s.settings, maxHeight: h } })),
      setTheme: (t) => set((s) => ({ settings: { ...s.settings, theme: t } })),
      setLang: (l) => set((s) => ({ settings: { ...s.settings, lang: l } })),
      setCountry: (c) => set((s) => ({ settings: { ...s.settings, gl: c } })),
      setAutoplayNext: (v) => set((s) => ({ settings: { ...s.settings, autoplayNext: v } })),
      setAudioMode: (v) => set((s) => ({ settings: { ...s.settings, audioMode: v } })),
      setSearchResults: (r) => set({ search: r }),
      setAccount: (patch) => set((s) => ({ account: { ...s.account, ...patch } })),
      applyBackup: (data) =>
        set((s) => ({
          settings: { ...s.settings, ...(data.settings ?? {}) },
          ...(data.history ? { history: data.history } : {}),
        })),
    }),
    {
      name: 'stfw-settings',
      storage: createJSONStorage(() => idbStorage),
      version: 1,
      migrate: (persisted) => {
        const p = (persisted as { settings?: Partial<Settings>; history?: HistoryEntry[] }) ?? {};
        return {
          settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
          history: Array.isArray(p.history) ? p.history : [],
        };
      },
      partialize: (s) => ({ settings: s.settings, history: s.history }),
    },
  ),
);