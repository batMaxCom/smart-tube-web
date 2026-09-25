import { expect, test, type Page } from '@playwright/test';
import { demoAsset, HOME_FIXTURE, playerFixture, SEARCH_FIXTURE } from './fixtures.js';

const MPD = demoAsset('media.mpd');
const MP4 = demoAsset('media.mp4');

async function mockApi(page: Page) {
  // catch-all регистрируется ПЕРВЫМ: Playwright применяет маршруты LIFO (последний зарегистрированный — приоритетнее)
  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: '{"error":"no mock"}',
    });
  });
  await page.route('**/api/v1/browse**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(HOME_FIXTURE),
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
  await page.route('**/api/v1/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SEARCH_FIXTURE),
    });
  });
  await page.route('**/api/v1/demo/media.mpd', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/dash+xml',
      body: MPD,
    });
  });
  // SegmentList: Shaka запрашивает init/сегменты через Range → отдаём как 206/200
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

async function waitVideoPlaying(page: Page, ms: number): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        return {
          ready: v.readyState,
          time: v.currentTime,
          paused: v.paused,
          error: v.error?.code ?? 0,
        };
      }),
    )
    .toBeTruthy();
  await expect
    .poll(
      async () => {
        const st = await page.evaluate(() => {
          const v = document.querySelector('video');
          return v ? { ready: v.readyState, time: v.currentTime } : null;
        });
        return (st && st.ready >= 2 && st.time > 0) || null;
      },
      { timeout: ms },
    )
    .toBeTruthy();
}

test.describe('SmartTube WEB smoke', () => {
  test('home → search → player (demo DASH) with TV navigation', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockApi(page);

    // 1. Главная
    await page.goto('/');
    await expect(page.getByText('Trending')).toBeVisible();
    const cards = page.locator('[data-testid^="card-"]');
    await expect(cards).toHaveCount(2);

    // 2. TV-навигация: стрелки двигают фокус, Enter открывает плеер
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('Enter');

    // 3. Плеер: демо-DASH реально играет
    await page.waitForURL(/\/watch\/smoketest-1/);
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео smoketest-1');
    await expect(page.getByText(/Демо-режим/)).toBeVisible();
    await waitVideoPlaying(page, 15_000);

    // 4. Назад на главную
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#?\/$/);
    await expect(cards).toHaveCount(2);

    // 5. Поиск: кнопка в шапке → поле → Enter → результаты
    await page.getByTestId('search-btn').click();
    await page.waitForURL(/#\/search/);
    const searchInput = page.locator('input[type="search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('котики');
    await searchInput.press('Enter');
    await expect(page.locator('[data-testid^="card-"]')).toHaveCount(SEARCH_FIXTURE.items.length);
    await expect(page.locator('[data-testid^="card-"]').first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
