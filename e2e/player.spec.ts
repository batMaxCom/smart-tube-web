import { expect, test } from '@playwright/test';
import { mockPlayerApi, playerFixture, REAL_FORMATS, waitVideoPlaying } from './fixtures.js';

test.describe('Фаза 2: плеер и рекомендации', () => {
  test('контролы: play/pause, скорость, громкость, coarse-реквизиты; субтитров в демо нет', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockPlayerApi(page);

    await page.goto('/#/watch/ctrl-1');
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео ctrl-1');
    await waitVideoPlaying(page);

    await page.getByTestId('player-overlay').hover();

    // субтитров нет (демо-DASH без text-треков)
    await expect(page.getByTestId('btn-subs')).toHaveCount(0);

    // скорость: 1× → 1.25×
    await expect(page.getByTestId('btn-rate')).toHaveText('1×');
    await page.getByTestId('btn-rate').click();
    await expect(page.getByTestId('btn-rate')).toHaveText('1.25×');
    await expect
      .poll(async () => page.evaluate(() => document.querySelector('video')?.playbackRate))
      .toBe(1.25);

    // mute / unmute
    const muted = () => page.evaluate(() => !!document.querySelector('video')?.muted);
    await expect.poll(muted).toBe(false);
    await page.getByTestId('btn-mute').click();
    await expect.poll(muted).toBe(true);
    await page.getByTestId('btn-mute').click();
    await expect.poll(muted).toBe(false);

    // seek: клик по ~70% таймлайна → переход к концу ролика
    const baseTime = (await page.evaluate(() => document.querySelector('video')?.currentTime)) as number;
    const box = (await page.getByTestId('seekbar').boundingBox())!;
    await page.getByTestId('seekbar').click({ position: { x: box.width * 0.7, y: 8 } });
    await expect
      .poll(async () => page.evaluate(() => document.querySelector('video')?.currentTime), {
        timeout: 8000,
      })
      .toBeGreaterThan(baseTime + 2);

    // результаты времени обновились в UI
    await expect(page.getByTestId('player-current')).not.toHaveText('0:00 /');

    // play/pause
    await page.getByTestId('btn-play').click();
    await expect
      .poll(async () => page.evaluate(() => document.querySelector('video')?.paused))
      .toBe(true);
    await page.getByTestId('btn-play').click();
    await expect
      .poll(async () => page.evaluate(() => document.querySelector('video')?.paused))
      .toBe(false);

    expect(errors).toEqual([]);
  });

  test('HQ-диалог: выбранные формат/кодек применяются к плееру', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await mockPlayerApi(page);
    await page.route('**/api/v1/player**', async (route, request) => {
      const id = new URL(request.url()).searchParams.get('id') ?? 'hq-1';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(playerFixture(id, { formats: REAL_FORMATS, demo: false })),
      });
    });

    await page.goto('/#/watch/hq-1');
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео hq-1');
    await waitVideoPlaying(page);

    // не демо: живые форматы, нет баннера демо-режима
    await expect(page.getByText(/Демо-режим/)).toHaveCount(0);

    await page.getByTestId('open-quality').click();
    const dialog = page.getByTestId('quality-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('1080p')).toBeVisible();
    await expect(dialog.getByText('720p60')).toBeVisible();
    await expect(dialog.getByText('360p')).toBeVisible();

    // выбрать 1080p/AVC
    await page.getByTestId('quality-1080p-avc').click();
    await expect(page.getByTestId('open-quality')).toContainText('1080< · AVC');

    // вернуть «Авто» (макс высота 0)
    await page.getByTestId('open-quality').click();
    await page.getByTestId('quality-auto').click();
    await expect(page.getByTestId('open-quality')).toContainText('Авто');

    expect(errors).toEqual([]);
  });

  test('рекомендации: up next, карточки, «показать ещё» и автоплей по окончании', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockPlayerApi(page);

    await page.goto('/#/watch/rec-0');
    await expect(page.getByTestId('recs-title')).toBeVisible();
    await expect(page.getByTestId('upnext')).toContainText('Следующее видео по автоплею');
    await expect(page.getByTestId('card-rec-1')).toBeVisible();
    await expect(page.getByTestId('card-rec-2')).toBeVisible();

    // «показать ещё»
    await page.getByTestId('recs-more').click();
    await expect(page.getByTestId('card-rec-3')).toBeVisible();
    await expect(page.getByTestId('recs-more')).toHaveCount(0);

    // клик по карточке рекомендации → открывается watch
    await page.getByTestId('card-rec-1').click();
    await page.waitForURL(/\/watch\/rec-1/);
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео rec-1');

    expect(errors).toEqual([]);
  });

  test('автоплей: окончание видео (ended) → переход к up next', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockPlayerApi(page);

    await page.goto('/#/watch/rec-0');
    await waitVideoPlaying(page);
    await expect(page.getByTestId('upnext')).toBeVisible();

    // имитируем конец воспроизведения
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) v.dispatchEvent(new Event('ended'));
    });
    await page.waitForURL(/\/watch\/rec-next/);
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео rec-next');

    expect(errors).toEqual([]);
  });

  test('комментарии: список, закреп, бесконечная подгрузка', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockPlayerApi(page);

    await page.goto('/#/watch/com-1');
    await expect(page.getByTestId('comments-title')).toContainText('Комментарии (2)');
    const items = page.getByTestId('comment-item');
    await expect(items).toHaveCount(2);

    await expect(page.getByText('📌 закреплён')).toBeVisible();
    await expect(page.getByTestId('comment-content').first()).toContainText('Первый комментарий');
    await expect(page.getByTestId('comment-author').nth(1)).toHaveText('Знаток');

    // скролл к концу → подгрузка continuation
    await items.last().scrollIntoViewIfNeeded();
    await expect
      .poll(() => items.count(), { timeout: 8000 })
      .toBe(4);
    await expect(page.getByTestId('comment-content').nth(2)).toContainText('Третий комментарий');

    expect(errors).toEqual([]);
  });

  test('настройки: переключение автовоспроизведения сохраняется', async ({ page }) => {
    await page.goto('/#/settings');

    const row = page.locator('text=Автовоспроизведение следующего видео').locator('..');
    const onBtn = row.getByRole('button', { name: /Вкл/ });
    const offBtn = row.getByRole('button', { name: 'Выкл' });
    await expect(onBtn).toHaveClass(/sky/);

    await offBtn.click();
    await expect(onBtn).not.toHaveClass(/sky/);
    await expect(offBtn).toHaveClass(/sky/);

    // сохранилось в IndexedDB → после перезагрузки снова «Выкл»
    await page.reload();
    await expect(
      page.locator('text=Автовоспроизведение следующего видео').locator('..').getByRole('button', { name: 'Выкл' }),
    ).toHaveClass(/sky/);
  });
});