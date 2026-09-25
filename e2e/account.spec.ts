import { expect, test, type Page } from '@playwright/test';
import {
  authGuest,
  authSignedIn,
  backupDoc,
  chatMessage,
  chatPollFixture,
  chatStarted,
  channelFixture,
  demoAsset,
  devicePending,
  ENGAGE_OK,
  favoritesFixture,
  playerFixture,
} from './fixtures.js';
import type {
  AuthStatus,
  DeviceFlowResponse,
  EngagementResult,
  FavoritesResponse,
} from '@stfw/shared';

const MPD_ABS = demoAsset('media.mpd').toString('utf8').replace('>media.mp4<', '>/api/v1/demo/media.mp4<');
const MP4 = demoAsset('media.mp4');

const signedInDevice = (): DeviceFlowResponse => ({ ...authSignedIn(), status: 'signed_in' });

async function registerCatchAll(page: Page) {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no mock"}' });
  });
}

interface MockAuthOpts {
  status: AuthStatus;
  poll?: DeviceFlowResponse | (() => DeviceFlowResponse);
  engage?: EngagementResult;
  favorites?: FavoritesResponse;
}

async function mockAuthRoutes(page: Page, opts: MockAuthOpts) {
  await page.route('**/api/v1/auth/status**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.status) });
  });
  await page.route('**/api/v1/auth/device', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(devicePending()) });
  });
  const poll = opts.poll ?? devicePending();
  await page.route('**/api/v1/auth/poll**', async (route) => {
    const next = typeof poll === 'function' ? poll() : poll;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(next) });
  });
  await page.route('**/api/v1/auth/logout', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  if (opts.engage) {
    await page.route('**/api/v1/engagement', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.engage) });
    });
  }
  if (opts.favorites) {
    await page.route('**/api/v1/favorites', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.favorites) });
    });
    await page.route('**/api/v1/favorites/remove', async (route, request) => {
      const body = request.postDataJSON() as { id?: string } | null;
      const items = (opts.favorites?.items ?? []).filter((f) => f.id !== body?.id);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) });
    });
  }
}

async function mockPlayerRoutes(page: Page, opts: { isLive?: boolean; chat?: boolean } = {}) {
  await page.route('**/api/v1/manifest**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/dash+xml', body: MPD_ABS });
  });
  await page.route('**/api/v1/player**', async (route, request) => {
    const id = new URL(request.url()).searchParams.get('id') ?? 'unknown';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(playerFixture(id, { isLive: opts.isLive })),
    });
  });
  await page.route('**/api/v1/demo/media.mpd', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/dash+xml', body: MPD_ABS });
  });
  await page.route('**/api/v1/demo/media.mp4', async (route, request) => {
    const range = request.headers()['range'];
    if (range) {
      const [startStr] = range.replace(/^bytes=/, '').split('-');
      const start = parseInt(startStr ?? '0', 10);
      const end = Math.min(start + 1024 * 1024 - 1, MP4.length - 1);
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
  if (opts.chat) {
    await page.route('**/api/v1/live/chat**', async (route, request) => {
      const id = new URL(request.url()).searchParams.get('id') ?? 'unknown';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatStarted(id, [chatMessage('m1', 'Автор1', 'Привет, эфир!')], 1)),
      });
    });
    await page.route('**/api/v1/live/chat/poll**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(chatPollFixture([chatMessage('m2', 'Автор2', 'Новое сообщение из эфира')], 2)),
      });
    });
  }
}

test.describe('Фаза 3: аккаунт, подписки, избранное, бэкап, лайв-чат', () => {
  test('вход по коду устройства: показ кода, шагов и ссылки на активацию', async ({ page }) => {
    await registerCatchAll(page);
    await mockAuthRoutes(page, { status: authGuest() });
    await page.goto('/#/account');

    await expect(page.getByTestId('account-start')).toBeVisible();
    await page.getByTestId('account-start').click();

    await expect(page.getByTestId('account-code')).toHaveText('ABCDEF');
    const link = page.getByTestId('account-verify');
    await expect(link).toHaveText('youtube.com/activate');
    await expect(link).toHaveAttribute('href', 'https://www.youtube.com/activate');
    await expect(page.getByTestId('account-poll-status')).toContainText('Ждём подтверждения');
  });

  test('поллинг завершает вход и показывает профиль', async ({ page }) => {
    let calls = 0;
    await registerCatchAll(page);
    await mockAuthRoutes(page, {
      status: authGuest(),
      poll: () => (++calls >= 2 ? signedInDevice() : devicePending('GHJKL7')),
    });
    await page.goto('/#/account');
    await page.getByTestId('account-start').click();
    await expect(page.getByTestId('account-name')).toHaveText('Мой канал', { timeout: 15_000 });
    await expect(page.getByTestId('nav-account')).toHaveText('М');
  });

  test('выход из аккаунта', async ({ page }) => {
    await registerCatchAll(page);
    await mockAuthRoutes(page, { status: authSignedIn() });
    await page.goto('/#/account');
    await expect(page.getByTestId('account-name')).toHaveText('Мой канал');
    await page.getByTestId('account-logout').click();
    await expect(page.getByTestId('account-start')).toBeVisible();
  });

  test('лайк/дизлайк на плеере (вход выполнен)', async ({ page }) => {
    await registerCatchAll(page);
    await mockAuthRoutes(page, { status: authSignedIn(), engage: ENGAGE_OK });
    await mockPlayerRoutes(page);
    await page.goto('/#/watch/lk-1');
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео lk-1');
    await expect(page.getByTestId('nav-account')).toHaveText('М');

    await page.getByTestId('btn-like').click();
    await expect(page.getByText('Лайк поставлен')).toBeVisible();
    await expect(page.getByTestId('btn-like')).toContainText('✓');

    await page.getByTestId('btn-like').click();
    await expect(page.getByText('Оценка снята')).toBeVisible();
  });

  test('лайк без входа подсказывает авторизоваться', async ({ page }) => {
    await registerCatchAll(page);
    await mockAuthRoutes(page, { status: authGuest(), engage: ENGAGE_OK });
    await mockPlayerRoutes(page);
    await page.goto('/#/watch/lk-2');
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео lk-2');
    await page.getByTestId('btn-like').click();
    await expect(page.getByText('Войдите в аккаунт, чтобы использовать')).toBeVisible();
  });

  test('подписка на канал', async ({ page }) => {
    await registerCatchAll(page);
    await mockAuthRoutes(page, { status: authSignedIn(), engage: ENGAGE_OK });
    await page.route('**/api/v1/channel**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(channelFixture('UCsub1')),
      });
    });
    await page.goto('/#/channel/UCsub1');
    await expect(page.getByTestId('channel-title')).toHaveText('Тестовый канал');

    await page.getByTestId('btn-subscribe').click();
    await expect(page.getByTestId('btn-subscribe')).toHaveText('Вы подписаны');
    await expect(page.getByText('Подписка оформлена')).toBeVisible();
  });

  test('лайв-чат: сообщения и инкрементальный poll', async ({ page }) => {
    await registerCatchAll(page);
    await mockAuthRoutes(page, { status: authGuest() });
    await mockPlayerRoutes(page, { isLive: true, chat: true });
    await page.goto('/#/watch/live-1');
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео live-1');

    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByTestId('chat-message').first()).toBeVisible();
    await expect(page.getByTestId('chat-author').first()).toHaveText('Автор1');
    await expect(page.getByTestId('chat-text').first()).toHaveText('Привет, эфир!');

    await expect(async () => {
      const texts = await page.getByTestId('chat-text').allTextContents();
      expect(texts).toContain('Новое сообщение из эфира');
    }).toPass({ timeout: 12_000 });
  });

  test('резервная копия: создание и восстановление по коду', async ({ page }) => {
    page.route('**/api/**', async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no mock"}' });
    });
    page.route('**/api/v1/backup', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"code":"XYZ123"}' });
    });
    page.route('**/api/v1/backup/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(backupDoc({ settings: { lang: 'en' }, history: [{ id: 'h1', title: 'Видео', ts: 1 }] })),
      });
    });

    await page.goto('/#/settings');
    await page.getByTestId('backup-create').click();
    await expect(page.getByTestId('backup-code')).toHaveText('XYZ123');

    await page.getByTestId('backup-restore-input').fill('xyz123');
    await page.getByTestId('backup-restore').click();
    await expect(page.getByTestId('backup-msg')).toContainText('восстановлены');
  });

  test('избранное в аккаунте: список и удаление', async ({ page }) => {
    const favs = favoritesFixture([
      { id: 'f1', title: 'Первое избранное', authorName: 'Автор А', addedAt: 1 },
      { id: 'f2', title: 'Второе избранное', authorName: 'Автор Б', addedAt: 2 },
    ]);
    await registerCatchAll(page);
    await mockAuthRoutes(page, { status: authSignedIn(), favorites: favs });
    await page.goto('/#/account');

    await expect(page.getByTestId('favorites-title')).toBeVisible();
    await expect(page.getByTestId('favorite-item')).toHaveCount(2);
    await page.getByTestId('favorite-remove').first().click();
    await expect(page.getByTestId('favorite-item')).toHaveCount(1);
    await expect(page.getByText('Второе избранное')).toBeVisible();
  });
});