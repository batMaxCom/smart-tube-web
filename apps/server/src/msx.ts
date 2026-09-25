import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Интеграция с Media Station X (MSX) — запуск веб-приложения из меню MSX.
 *
 * Спецификация:
 * - Start Object: https://msx.benzac.de/wiki/index.php?title=Start_Object
 * - Menu Root Object: https://msx.benzac.de/wiki/index.php?title=Menu_Root_Object
 * - Content Root Object / Items: https://msx.benzac.de/wiki/index.php?title=Content_Item_Object
 * - Actions (link:/content:): https://msx.benzac.de/wiki/index.php?title=Actions
 * - Внешние HTML5-приложения (нужен выход в MSX):
 *   https://msx.benzac.de/wiki/index.php?title=Tips_%26_Tricks
 *
 * Схема запуска: MSX → /msx/start.json → menu.json → link:{APP} → веб-интерфейс.
 * Пользователь в MSX добавляет «стартовый параметр» со ссылкой
 * http://<хост>:<порт>/msx/start.json, дальше всё разруливает сам MSX.
 *
 * Адреса внутри объектов абсолютные: MSX не умеет разрешать относительные
 * ссылки в действиях link:/content:. База берётся из заголовка Host запроса
 * (nginx проксирует с X-Forwarded-Proto), а при его отсутствии — из
 * serverIp:port. Жёсткий адрес задаётся переменной окружения MSX_PUBLIC_URL.
 */

const APP_NAME = 'SmartTube WEB';
const APP_VERSION = '1.0.0';
const APP_ICON = 'smart-display';
const APP_COLOR = '#e62117';

/** Параметр запуска: {PREFIX}{SERVER} подставляет сам MSX. */
const MENU_PARAMETER = 'menu:{PREFIX}{SERVER}/msx/menu.json';

export interface MsxOptions {
  /** Жёстко заданный внешний адрес (например `http://192.168.1.10:8085`). */
  publicUrl?: string | undefined;
  /** Резервный хост, если в запросе нет заголовка Host. */
  serverIp: string;
  /** Резервный порт веб-интерфейса, если в запросе нет заголовка Host. */
  port: number;
}

interface HeaderedRequest {
  headers: { host?: string | undefined; 'x-forwarded-proto'?: string | undefined };
  protocol?: string;
}

/** Абсолютная база (без слеша на конце) для ссылок в объектах MSX. */
export function getBaseUrl(req: HeaderedRequest, serverIp: string, port: number): string {
  const host = req.headers.host?.trim();
  const forwarded = req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http';
  const proto = forwarded.split(',')[0]?.trim();
  if (host) return `${proto || 'http'}://${host}`;
  return `http://${serverIp}:${port}`;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Ссылка на веб-приложение. msx=1 включает в UI кнопку выхода обратно в MSX. */
export function appUrl(baseUrl: string, hash = ''): string {
  return `${baseUrl}/?msx=1${hash}`;
}

export function buildStartObject(): Record<string, unknown> {
  return {
    name: APP_NAME,
    version: APP_VERSION,
    parameter: MENU_PARAMETER,
    welcome: 'none',
    launcher: {
      name: APP_NAME,
      icon: APP_ICON,
      image: 'none',
      color: APP_COLOR,
    },
  };
}

export function buildMenuObject(baseUrl: string): Record<string, unknown> {
  const base = trimSlash(baseUrl);
  return {
    name: APP_NAME,
    version: APP_VERSION,
    headline: APP_NAME,
    // Открываем приложение сразу; при возврате из link-действия MSX восстановит меню.
    action: `link:${appUrl(base)}`,
    menu: [
      {
        icon: APP_ICON,
        label: APP_NAME,
        extensionLabel: 'Открыть',
        data: `${base}/msx/home.json`,
      },
      {
        icon: 'information',
        label: 'О проекте',
        data: `${base}/msx/about.json`,
      },
    ],
  };
}

export function buildHomeObject(baseUrl: string): Record<string, unknown> {
  const base = trimSlash(baseUrl);
  return {
    type: 'pages',
    headline: APP_NAME,
    template: {
      type: 'separate',
      layout: '0,0,6,3',
      icon: `msx-white-soft:${APP_ICON}`,
      color: 'msx-glass',
    },
    items: [
      {
        focus: true,
        title: 'Смотреть',
        titleFooter: 'Главная лента, подписки, вкладки каналов',
        action: `link:${appUrl(base)}`,
      },
      {
        title: 'Поиск',
        titleFooter: 'Поиск по YouTube с экранной клавиатурой',
        action: `link:${appUrl(base, '#/search')}`,
      },
      {
        title: 'Настройки',
        titleFooter: 'Страна, язык, качество, «Смотреть на ТВ»',
        action: `link:${appUrl(base, '#/settings')}`,
      },
      {
        title: 'О проекте',
        titleFooter: 'Как подключить и вернуться в MSX',
        action: `content:${base}/msx/about.json`,
      },
    ],
  };
}

export function buildAboutObject(baseUrl: string): Record<string, unknown> {
  const base = trimSlash(baseUrl);
  return {
    type: 'pages',
    headline: 'О проекте',
    template: {
      type: 'separate',
      layout: '0,4,6,2',
      icon: `msx-white-soft:information`,
      color: 'msx-glass',
    },
    items: [
      {
        type: 'space',
        layout: '0,0,12,4',
        color: 'msx-black-soft',
        text: [
          APP_NAME,
          '',
          'Веб-клиент YouTube для ТВ и мобильных устройств.',
          `Адрес: ${base}`,
          '',
          'Запуск: в MSX откройте «Настройки → Стартовые параметры» и добавьте ссылку',
          `${base}/msx/start.json`,
          '',
          'Если запуск блокируется, отключите «Настройки → Проверка ссылок».',
          '',
          'Кнопка «Выйти в MSX» в шапке приложения возвращает вас в меню MSX.',
        ],
      },
      {
        title: 'Открыть приложение',
        titleFooter: 'Вернуться к просмотру',
        action: `link:${appUrl(base)}`,
      },
    ],
  };
}

export function registerMsxRoutes(app: FastifyInstance, options: MsxOptions): void {
  const publicUrl = options.publicUrl?.trim();

  const base = (req: HeaderedRequest): string =>
    publicUrl ? trimSlash(publicUrl) : getBaseUrl(req, options.serverIp, options.port);

  const send = (reply: FastifyReply, payload: Record<string, unknown>) => {
    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'no-store');
    return reply.code(200).send(payload);
  };

  app.get('/msx/start.json', async (_req, reply) => send(reply, buildStartObject()));
  app.get('/msx/menu.json', async (req, reply) => send(reply, buildMenuObject(base(req))));
  app.get('/msx/home.json', async (req, reply) => send(reply, buildHomeObject(base(req))));
  app.get('/msx/about.json', async (req, reply) => send(reply, buildAboutObject(base(req))));

  // Удобная ссылка: /msx → start-объект.
  const redirect = async (_req: unknown, reply: FastifyReply) =>
    reply.redirect('/msx/start.json', 302);
  app.get('/msx', redirect);
  app.get('/msx/', redirect);
}
