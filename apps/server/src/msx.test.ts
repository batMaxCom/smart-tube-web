import { describe, expect, it } from 'vitest';
import {
  appUrl,
  buildAboutObject,
  buildHomeObject,
  buildMenuObject,
  buildStartObject,
  getBaseUrl,
} from './msx.js';

const BASE = 'http://192.168.1.10:8085';

describe('getBaseUrl', () => {
  it('берёт хост из заголовка Host', () => {
    expect(getBaseUrl({ headers: { host: 'tv.local:8085' } }, '127.0.0.1', 3090)).toBe(
      'http://tv.local:8085',
    );
  });

  it('учитывает X-Forwarded-Proto (за nginx)', () => {
    expect(
      getBaseUrl({ headers: { host: 'example.com', 'x-forwarded-proto': 'https,http' } }, 'x', 1),
    ).toBe('https://example.com');
  });

  it('падает на serverIp:port, если Host нет', () => {
    expect(getBaseUrl({ headers: {} }, '10.0.0.5', 8085)).toBe('http://10.0.0.5:8085');
  });
});

describe('start object', () => {
  it('ссылается на меню через {PREFIX}{SERVER} и содержит launcher', () => {
    const start = buildStartObject();
    expect(start.parameter).toBe('menu:{PREFIX}{SERVER}/msx/menu.json');
    expect(start.welcome).toBe('none');
    expect(start.launcher).toMatchObject({ icon: 'smart-display', color: '#e62117' });
  });
});

describe('menu object', () => {
  it('открывает приложение сразу и ведёт на контент-страницы', () => {
    const menu = buildMenuObject(BASE);
    expect(menu.action).toBe(`link:${appUrl(BASE)}`);
    const items = menu.menu as Array<{ data: string }>;
    expect(items.map((i) => i.data)).toEqual([`${BASE}/msx/home.json`, `${BASE}/msx/about.json`]);
  });

  it('не дублирует слеш, если база задана со слэшем', () => {
    const menu = buildMenuObject('http://10.0.0.5:8085/');
    expect(menu.action).toBe(`link:${appUrl('http://10.0.0.5:8085')}`);
    expect((menu.menu as Array<{ data: string }>)[0].data).toBe('http://10.0.0.5:8085/msx/home.json');
  });
});

describe('home object', () => {
  it('даёт прямые ссылки на экраны приложения', () => {
    const home = buildHomeObject(BASE);
    expect(home.type).toBe('pages');
    const items = home.items as Array<{ focus?: boolean; action: string }>;
    expect(items[0].focus).toBe(true);
    expect(items.map((i) => i.action)).toEqual([
      `link:${BASE}/?msx=1`,
      `link:${BASE}/?msx=1#/search`,
      `link:${BASE}/?msx=1#/settings`,
      `content:${BASE}/msx/about.json`,
    ]);
  });
});

describe('about object', () => {
  it('содержит хотя бы один выбираемый пункт (требование MSX к content page)', () => {
    const about = buildAboutObject(BASE);
    const items = about.items as Array<{ type?: string; action?: string; text?: string[] }>;
    expect(items.some((item) => item.action && item.type !== 'space')).toBe(true);
    const text = items.find((item) => item.type === 'space')?.text?.join('\n') ?? '';
    expect(text).toContain(`${BASE}/msx/start.json`);
  });
});

describe('appUrl', () => {
  it('включает признак режима MSX', () => {
    expect(appUrl(BASE)).toBe(`${BASE}/?msx=1`);
    expect(appUrl(BASE, '#/watch/dQw4w9WgXcQ')).toBe(`${BASE}/?msx=1#/watch/dQw4w9WgXcQ`);
  });
});
