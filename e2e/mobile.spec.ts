import { expect, test, type Page } from '@playwright/test';
import { HOME_FIXTURE, mockPlayerApi, waitVideoPlaying } from './fixtures.js';

/** iPhone 12: узкий экран, тач-указатель, без hover. */
const PHONE = { width: 390, height: 844 };

/** Прозрачность панели/центральной кнопки; 1, если элемента уже нет (плеер ушёл дальше). */
const opacity = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .evaluate((el) => Number(getComputedStyle(el).opacity))
    .catch(() => 1);

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const paused = (page: Page) => page.evaluate(() => !!document.querySelector('video')?.paused);

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

test.describe('Мобильный режим (телефон)', () => {
  test('плеер: при воспроизведении контролы гаснут, тап их возвращает', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockPlayerApi(page);

    await page.goto('/#/watch/mob-1', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео mob-1');
    await waitVideoPlaying(page);

    // во время воспроизведения панель и центральная кнопка гаснут сами
    await expect.poll(() => opacity(page, 'player-bottom'), { timeout: 8000 }).toBeLessThan(0.1);
    await expect.poll(() => opacity(page, 'btn-play')).toBeLessThan(0.1);

    // тап по видео (в стороне от центральной кнопки) возвращает панель
    await page.getByTestId('player-overlay').tap({ position: { x: 24, y: 40 } });
    await expect.poll(() => opacity(page, 'player-bottom')).toBeGreaterThan(0.9);
    await expect.poll(() => opacity(page, 'btn-play')).toBeGreaterThan(0.9);
    // тап не должен был задеть play/pause
    expect(await paused(page)).toBe(false);

    expect(errors).toEqual([]);
  });

  test('плеер: после тапа панель снова гаснет, на паузе остаётся', async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto('/#/watch/mob-2', { waitUntil: 'domcontentloaded' });
    await waitVideoPlaying(page);

    await page.getByTestId('player-overlay').tap({ position: { x: 24, y: 40 } });
    await expect.poll(() => opacity(page, 'player-bottom')).toBeGreaterThan(0.9);

    // тап запустил автоскрытие заново — панель должна исчезнуть сама
    await expect.poll(() => opacity(page, 'player-bottom'), { timeout: 6000 }).toBeLessThan(0.1);
  });

  test('плеер: на паузе контролы не прячутся', async ({ page }) => {
    await mockPlayerApi(page);
    await page.goto('/#/watch/mob-3', { waitUntil: 'domcontentloaded' });
    await waitVideoPlaying(page);

    await page.getByTestId('btn-play').tap();
    await expect.poll(() => paused(page)).toBe(true);

    await page.waitForTimeout(4500);
    expect(await opacity(page, 'player-bottom')).toBeGreaterThan(0.9);
    expect(await opacity(page, 'btn-play')).toBeGreaterThan(0.9);
  });

  test('страницы не разъезжаются по горизонтали на телефоне', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockPlayerApi(page);
    await page.route('**/api/v1/browse**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(HOME_FIXTURE),
      });
    });

    for (const path of ['/#/', '/#/search', '/#/settings', '/#/history', '/#/watch/mob-4']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      expect(await noHorizontalOverflow(page), `горизонтальный скролл на ${path}`).toBe(true);
    }

    expect(errors).toEqual([]);
  });

  test('MSX: адрес запуска в настройках и кнопка выхода', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockPlayerApi(page);

    // обычный режим: адрес запуска виден, кнопки выхода нет
    await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('msx-start-url')).toHaveText(/\/msx\/start\.json$/);
    await expect(page.getByTestId('btn-exit-msx')).toHaveCount(0);

    // запуск из MSX: кнопка выхода есть и уводит с ?msx=1
    await page.goto('/?msx=1#/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('btn-exit-msx')).toBeVisible();
    await expect(page.getByTestId('msx-start-url')).toHaveText(/\/msx\/start\.json$/);
    await page.getByTestId('btn-exit-msx').click();
    await expect(page).not.toHaveURL(/msx=1/);

    expect(errors).toEqual([]);
  });
});
