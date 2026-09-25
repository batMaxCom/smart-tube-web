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

По умолчанию backend работает в strict local-only режиме: InnerTube, thumbnails/avatars и видеопотоки запрашиваются с IP сервера, а браузер получает только локальные URL приложения. Если YouTube недоступен и включён `DEMO_MODE=auto`, сервер отдаёт демо-контент. Ссылка подтверждения OAuth остаётся внешней, поскольку пользователь должен авторизоваться на YouTube.

Режим проксирования задаётся через `PROXY_STREAMS`, а демо-режим — через `DEMO_MODE` (env сервера):

| Значение | Поведение |
| -------- | --------- |
| `auto` (если env не задан) | по детекту: бот-гейт/недоступность YouTube → демо |
| `1` / `on`            | всегда демо (стенды, демонстрация без интернета) |
| `0` / `off`           | всегда реальный поток; при недоступности YouTube — ошибка 502 |

`PROXY_STREAMS=1` (по умолчанию) проксирует видео и изображения через backend; `PROXY_STREAMS=0` оставляет прямые CDN-URL и подходит только для локальной разработки.

Текущий режим и доступность YouTube видны в `GET /api/v1/health` (`demoMode`, `youtubeReachable`, `proxyStreams`).

### Почему с датацентра может не быть реальных потоков

YouTube режет два разных случая, и в логах они выглядят одинаково («форматы есть, ссылок нет»):

1. **Ссылок нет вообще** — бот-гейт по IP/клиенту. Лечится сменой player-клиента InnerTube.
2. **YouTube прислал `signatureCipher` вместо `url`** — поток играбелен, но требует JS-интерпретатора для n-трансформа. В Node его нет, поэтому такие клиенты не играбельны (в логах: `To decipher URLs, you must provide your own JavaScript evaluator`).

Порядок фолбэков: сначала WEB, затем клиенты из `PLAYER_CLIENTS`. По умолчанию `ANDROID_VR,IOS,ANDROID,TV` — они отдают готовые ссылки в полном качестве и не требуют PO-токенов.

Диагностика прямо на сервере (показывает, какой клиент реально отдаёт ссылки с этого IP):

```bash
docker compose -f deploy/docker-compose.yml exec server node apps/server/dist/debug-yt.js dQw4w9WgXcQ
```

```
WEB            OK                 ссылок:  0/27 видео:  0  макс:    —p  ← только signatureCipher
ANDROID_VR     OK                 ссылок: 27/27 видео: 23  макс: 2160p  ← играбельно
IOS            OK                 ссылок: 24/24 видео: 22  макс: 2160p  ← играбельно
ANDROID        OK                 ссылок:  1/30 видео:  1  макс:  360p  ← без PO-токена
TV             UNPLAYABLE         ссылок:  0/0
```

Если в колонке «ссылок» ноль у всех клиентов — нужен residential-прокси для исходящих запросов (настраивается на уровне Docker/VPN, env у backend'а для этого нет).

Свой порядок клиентов без пересборки:

```bash
PLAYER_CLIENTS=ANDROID_VR,IOS,ANDROID docker compose -f deploy/docker-compose.yml up -d
```

Проверка после деплоя (в ответе должен быть `false`, а `manifestPath` — не `/api/v1/demo/media.mpd`):

```bash
curl -s 'http://localhost:8085/api/v1/player?id=dQw4w9WgXcQ' | grep -o '"demo":[a-z]*'
```

Запуск в Docker:

```bash
cd deploy
docker compose up -d --build          # demoMode: off, только реальные потоки
DEMO_MODE=auto docker compose up -d   # при сбое YouTube показывать демо
```
