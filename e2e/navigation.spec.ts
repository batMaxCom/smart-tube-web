import { expect, test, type Page } from '@playwright/test';
import {
  channelFixture,
  demoAsset,
  HOME_FIXTURE,
  MIXED_FIXTURE,
  NEXT_FIXTURE,
  playerFixture,
  playlistFixture,
  videoItem,
} from './fixtures.js';

const MPD = demoAsset('media.mpd');
const MP4 = demoAsset('media.mp4');

async function mockApi(page: Page, overrides?: { browse?: unknown }) {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no mock"}' });
  });
  await page.route('**/api/v1/browse**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(overrides?.browse ?? HOME_FIXTURE),
    });
  });
  await page.route('**/api/v1/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MIXED_FIXTURE),
    });
  });
  await page.route('**/api/v1/channel**', async (route, request) => {
    const id = new URL(request.url()).searchParams.get('id') ?? 'ch';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(channelFixture(id)),
    });
  });
  await page.route('**/api/v1/playlist**', async (route, request) => {
    const id = new URL(request.url()).searchParams.get('id') ?? 'pl';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(playlistFixture(id)),
    });
  });
  await page.route('**/api/v1/next**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(NEXT_FIXTURE),
    });
  });
  await page.route('**/api/v1/player**', async (route, request) => {
    const id = new URL(request.url()).searchParams.get('id') ?? 'unknown';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(playerFixture(id)),
    });
  });
  await page.route('**/api/v1/demo/media.mpd', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/dash+xml', body: MPD });
  });
  await page.route('**/api/v1/demo/media.mp4', async (route, request) => {
    const range = request.headers()['range'];
    if (range) {
      const [startStr, endStr] = range.replace(/^bytes=/, '').split('-');
      const start = parseInt(startStr ?? '0', 10);
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024 - 1, MP4.length - 1);
      await route.fulfill({
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${MP4.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
        },
        body: MP4.subarray(start, end + 1),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'video/mp4', body: MP4 });
  });
}

async function openSearch(page: Page) {
  await page.goto('/#/search');
  const input = page.locator('input[type="search"]');
  await expect(input).toBeVisible();
  await input.fill('микс');
  await input.press('Enter');
  const cards = page.locator('[data-testid^="card-"]');
  await expect(cards).toHaveCount(3); // видео + канал + плейлист
}

test.describe('Фаза 1: навигация и контент', () => {
  test('канал: страница, шапка, табы, видео', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockApi(page);

    await openSearch(page);
    await page.locator('[data-testid="card-channel-UCmixchannel12345"]').click();
    await page.waitForURL(/\/channel\/UCmixchannel12345/);

    await expect(page.getByTestId('channel-title')).toHaveText('Тестовый канал');
    await expect(page.getByText('@test-channel')).toBeVisible();
    await expect(page.locator('[data-testid^="channel-tab-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="card-"]')).toHaveCount(2);

    // таб Shorts → снова лента (mock статичен)
    await page.getByTestId('channel-tab-shorts').click();
    await expect(page.locator('[data-testid^="card-"]')).toHaveCount(2);
    await expect(page.getByTestId('channel-tab-shorts')).toHaveClass(/bg-white\/15|bg-sky/);

    expect(errors).toEqual([]);
  });

  test('плейлист: заголовок, автор, видео', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockApi(page);

    await openSearch(page);
    await page.locator('[data-testid="card-playlist-PLmixplaylist"]').click();
    await page.waitForURL(/\/playlist\/PLmixplaylist/);

    await expect(page.getByTestId('playlist-title')).toHaveText('Тестовый плейлист');
    await expect(page.getByText('Автор')).toBeVisible();
    await expect(page.locator('[data-testid^="card-"]')).toHaveCount(2);

    expect(errors).toEqual([]);
  });

  test('настройки: тема переключается и сохраняется', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockApi(page);

    await page.goto('/#/settings');
    await page.getByRole('button', { name: 'Светлая' }).click();
    await expect(page.locator('html')).toHaveClass(/theme-light/);

    await page.reload();
    await expect(page).toHaveURL(/#\/settings/);
    await expect(page.locator('html')).toHaveClass(/theme-light/);

    await page.getByRole('button', { name: 'Тёмная' }).click();
    await expect(page.locator('html')).not.toHaveClass(/theme-light/);

    expect(errors).toEqual([]);
  });

  test('история: просмотр пишется локально, открытие возвращает в плеер', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockApi(page);

    await page.goto('/');
    const cards = page.locator('[data-testid^="card-"]');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('Enter'); // открыть первое видео (smoketest-1)
    await page.waitForURL(/\/watch\/smoketest-1/);
    await expect(page.getByTestId('player-title')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#?\/$/);

    await page.getByTestId('nav-history').click();
    const entry = page.getByTestId('history-smoketest-1');
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('Демо-видео smoketest-1');
    await entry.click();
    await page.waitForURL(/\/watch\/smoketest-1/);
    await expect(page.getByTestId('player-title')).toBeVisible();

    // очистка истории
    await page.getByTestId('nav-history').click();
    await page.getByRole('button', { name: 'Очистить' }).click();
    await expect(page.getByText(/Пока ничего не смотрели/)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('бесконечный скролл через continuation', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const scrollFeed = {
      sections: [
        {
          title: 'Scroll',
          items: Array.from({ length: 30 }, (_, i) => videoItem(`scroll-${i}`, `Ролик ${i}`)),
        },
      ],
      continuation: 'sc-first',
    };
    await mockApi(page, { browse: scrollFeed });

    await page.goto('/');
    const cards = page.locator('[data-testid^="card-"]');
    await expect(cards).toHaveCount(30);

    await page.mouse.wheel(0, 10_000);
    // sentinel пересекает viewport → /next → вторая порция (continuation завершает ленту)
    await expect(page.getByText('Следующая порция')).toBeVisible({ timeout: 10_000 });
    await expect(cards).toHaveCount(32);

    expect(errors).toEqual([]);
  });
});