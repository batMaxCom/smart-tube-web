# Changelog

## v1.0.0 (Фаза 5 — подготовка к релизу)
- i18n: базовый слой (ru/en JSON + `useT`), интеграция в шапку, настройки, поиск, pairing.
- Документация: README (установка на Android TV / Samsung / LG / Roku, self-hosting, API).
- nginx: cache-control `no-cache` для `sw.js`/`manifest.webmanifest`, immutable для `assets/*`.
- Производительность: серверные TTL-кэши (player/home/search/channel/playlist/feed/comments/related),
  лимит буфера лайв-чата (300 сообщений), бесконечная пагинация через continuation.
- Автообновление PWA уже в основе (SW registration + banner при актуальном обновлении).

## v0.4.0 (Фаза 4) — ТВ-специфика и автономность
- PWA: иконки, manifest (`standalone`, maskable), `offline.html`, service worker
  (precache + network-first навигация + stale-while-revalidate статики, trim 120), автообновление.
- PiP + Media Session (metadata, artwork, actions play/pause/seek±/next, playbackState).
- Голосовой поиск (Web Speech API) + экранная клавиатура (OSK) как fallback.
- Фоновый аудио-режим (аудио-обложка, Wake Lock `screen`, release на паузе).
- Pairing «Смотреть на ТВ»: start/status/poll/send (in-memory, TTL 10 мин, is-код), запуск видео на ТВ.

## v0.3.0 (Фаза 3) — Аккаунт и персонализация
- OAuth device-flow (вход по коду устройства), подписки/лайки/дизлайки через engagement.
- Серверные подписки, избранное, история (best-effort) + локальная кистория IndexedDB.
- Лайв-чат (buffer + incremental poll, до 300 сообщений).
- Резервная копия и синхронизация настроек по ID-коду (create/restore).
- nginx + Docker compose (backend 3090, web 8080).

## v0.2.0 (Фаза 2) — Плеер (ядро)
- Shaka Player с демо-DASH; play/pause, seek, скорость, громкость, субтитры.
- HQ-диалог: формат (AVC/VP9/AV01), разрешение, память выбора.
- Автозапуск следующего, «показать ещё», рекомендации, комментарии, SponsorBlock.
- Медиастатус рендерится в системном «сейчас играет» (Media Session).

## v0.1.0 (Фаза 0–1) — Каркас, навигация и контент
- Монорепо (web/server/shared), vite + tailwind, D-pad/Tab-фокус, хоткеи, роутер.
- Прокси: browse/search/next/channel/playlist/live/subscriptions; бесконечный скролл.
- Локальные настройки (тема/язык/страна/кодек), история; Playwright e2e и Vitest.
