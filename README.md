# SmartTube for WEB

Веб-клиент YouTube с TV-интерфейсом в духе SmartTube. См. **[ROADMAP.md](./ROADMAP.md)**.

## Структура

```
apps/web/       # Frontend SPA (React + Vite + TS + Tailwind + Shaka Player)
apps/server/    # Backend-прокси (Fastify + youtubei.js / innertube)
packages/shared # Общие типы/DTO
deploy/         # Docker compose, nginx
e2e/            # Playwright e2e-тесты
tools/          # Скрипты (генерация иконок, демо-ассеты)
```

## Быстрый старт (dev)

```bash
npm install
npm run dev          # server :3090 + web :5173 (vite проксирует /api)
```

## Быстрый старт (Docker)

```bash
docker compose -f deploy/docker-compose.yml up --build
# Web → http://localhost:8080 (nginx), API → http://server:3090
```

## PWA
- Автоматическая установка на главный экран (Android/Chrome/Edge).
- Оффлайн-фоллбек (`/offline.html`), обновления SW с кнопкой перезагрузки.
- Фоновый аудио-режим (Wake Lock) позволяет выключать экран при воспроизведении.

## Установка на ТВ

| Платформа | Инструкция |
|---|---|
| Android TV | Открыть браузер/TV Bro, перейти на URL, «Добавить на главный экран» или установить PWA. |
| Samsung Tizen | Встроенный браузер (Internet). Навигация с пульта поддерживается. |
| LG webOS | Web Browser, запуск по URL. Рекомендуется добавить в закладки. |
| Roku | Встроенный браузер (в зависимости от модели). |
| Apple TV (tvOS) | Ограничения MSE в некоторых браузерах — рекомендуется Android TV. |

## Голосовой поиск и экранная клавиатура
- Web Speech API (SpeechRecognition/webkitSpeechRecognition) при поддержке.
- Автоматический fallback на экранную клавиатуру (OSK), если API недоступен.

## Pairing «Смотреть на ТВ»
- ТВ показывает код на `/pairing`. Телефон открывает `/#/pairing/<CODE>` и отправляет ссылку YouTube/videoId — видео запускается на ТВ.
- Локальный HTTP command-channel (in-memory).

## API (v1)

| Endpoint                                         | Описание                                |
| ------------------------------------------------ | --------------------------------------- |
| `GET /api/v1/health`                             | статус сервера                          |
| `GET /api/v1/browse`                             | главная лента                           |
| `GET /api/v1/search?q=`                          | поиск                                   |
| `GET /api/v1/player?id=`                         | данные видео + список форматов          |
| `GET /api/v1/manifest/:id.mpd?codec=&maxHeight=` | DASH-MPD для Shaka (потоки googlevideo) |
| `POST /api/v1/pairing/start`                    | старт сессии ТВ-подбора                 |
| `GET /api/v1/pairing/status?code=`              | статус пары                             |
| `GET /api/v1/pairing/poll?code=`                 | опрос команд на ТВ                      |
| `POST /api/v1/pairing/send`                     | отправка видео с телефона на ТВ         |
| `POST /api/v1/pairing/disconnect`               | завершение сессии                       |

## Демо-режим и реальные потоки

Если сервер выходит в интернет с «домашнего» IP (провайдер), YouTube отдаёт подписанные URL потоков — приложение играет реальные видео. С датацентр/VPS/облачного IP YouTube выдаёт бот-гейт (форматы без URL) — сервер автоматически включает демо-контент (тестовый DASH), чтобы приложение оставалось рабочим.

Режим задаётся через `DEMO_MODE` (env сервера):

| Значение | Поведение |
| -------- | --------- |
| `auto` (по умолчанию) | по детекту: бот-гейт/недоступность YouTube → демо |
| `1` / `on`            | всегда демо (стенды, демонстрация без интернета) |
| `0` / `off`           | всегда реальный поток; при недоступности YouTube — ошибка 502 |

Текущий режим и доступность YouTube видны в `GET /api/v1/health` (`demoMode`, `youtubeReachable`).

Запуск в Docker:

```bash
cd deploy
docker compose up -d --build          # demoMode: auto
DEMO_MODE=0 docker compose up -d      # только реальные потоки
```
