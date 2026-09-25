import { expect, test, type Page } from '@playwright/test';
import { SEARCH_FIXTURE, mockPlayerApi, waitVideoPlaying } from './fixtures.js';

test.describe('Фаза 4: PWA', () => {
  test('manifest и service worker регистрируются, офлайн-шелл доступен', async ({ page }) => {
    await page.goto('/');

    const manifest = await page.evaluate(async () => {
      const r = await fetch('/manifest.webmanifest');
      return { status: r.status, body: await r.text() };
    });
    expect(manifest.status).toBe(200);
    const parsed = JSON.parse(manifest.body) as { name: string; icons: { src: string }[] };
    expect(parsed.name).toBe('SmartTube WEB');
    expect(parsed.icons.length).toBeGreaterThanOrEqual(3);

    const swReady = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active));
    await expect.poll(() => swReady, { timeout: 8000 }).toBe(true);

    // SW принял управление страницей (clients.claim)
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 8000 })
      .toBe(true);

    // офлайн: навигационная загрузка отдаётся из кэша (offline-shell), fallback-страница доступна
    const ctx = page.context();
    await ctx.setOffline(true);
    await page.reload();
    await expect(page.locator('#root')).toHaveCount(1);
    expect(await page.title()).toBe('SmartTube WEB');
    await ctx.setOffline(false);
  });
});

test.describe('Фаза 4: PiP + Media Session', () => {
  test('PiP-кнопка переключается, метаданные и клавиши Медиа установлены', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __pip?: HTMLVideoElement | null };
      w.__pip = null;
      Object.defineProperty(document, 'pictureInPictureElement', {
        configurable: true,
        get: () => w.__pip ?? null,
      });
      HTMLVideoElement.prototype.requestPictureInPicture = function (this: HTMLVideoElement) {
        w.__pip = this;
        this.dispatchEvent(new Event('enterpictureinpicture'));
        return Promise.resolve();
      };
      document.exitPictureInPicture = function () {
        const v = document.querySelector('video');
        w.__pip = null;
        v?.dispatchEvent(new Event('leavepictureinpicture'));
        return Promise.resolve();
      };
    });
    await mockPlayerApi(page);

    await page.goto('/#/watch/pip-1');
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео pip-1');
    await waitVideoPlaying(page);

    // Media Session: метаданные и состояние воспроизведения
    expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Демо-видео pip-1');
    expect(await page.evaluate(() => navigator.mediaSession.metadata?.artist)).toBe('Smoke');
    await expect
      .poll(async () => page.evaluate(() => navigator.mediaSession.playbackState))
      .toBe('playing');

    // PiP: включение и выключение через кнопку плеера
    await page.getByTestId('player-overlay').hover();
    await expect(page.getByTestId('btn-pip')).toBeVisible();
    await expect(page.getByTestId('btn-pip')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('btn-pip').click();
    await expect(page.getByTestId('btn-pip')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('btn-pip').click();
    await expect(page.getByTestId('btn-pip')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('Фаза 4: голосовой поиск и экранная клавиатура', () => {
  test('голосовой поиск: распознанная фраза подставляется и ищет', async ({ page }) => {
    await page.addInitScript(() => {
      class FakeRecognition {
        lang = '';
        interimResults = false;
        continuous = false;
        onresult: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        start() {
          (window as unknown as { __rec?: unknown }).__rec = this;
        }
        stop() {
          (window as unknown as { __rec?: unknown }).__rec = undefined;
        }
      }
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    });
    await page.route('**/api/v1/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SEARCH_FIXTURE),
      });
    });

    await page.goto('/#/search/');
    await page.getByTestId('btn-voice').click();
    await expect(page.getByTestId('voice-hint')).toBeVisible();

    await page.evaluate(() => {
      const rec = (
        window as unknown as {
          __rec?: { onresult: ((e: unknown) => void) | null; onend: (() => void) | null };
        }
      ).__rec;
      rec?.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: 'котики' }, length: 1 }] });
      rec?.onend?.();
    });

    await expect(page.getByPlaceholder('Поиск на YouTube…')).toHaveValue('котики');
    await expect(page.getByTestId('card-smoketest-search')).toBeVisible();
    await expect(page.getByTestId('voice-hint')).toHaveCount(0);
  });

  test('экранная клавиатура: сборка запроса и запуск поиска', async ({ page }) => {
    await page.route('**/api/v1/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SEARCH_FIXTURE),
      });
    });

    await page.goto('/#/search/');
    await page.getByTestId('btn-keyboard').click();
    await expect(page.getByTestId('osk')).toBeVisible();

    await page.getByTestId('osk-key-c').click();
    await page.getByTestId('osk-key-a').click();
    await page.getByTestId('osk-key-t').click();
    await expect(page.getByPlaceholder('Поиск на YouTube…')).toHaveValue('cat');

    await page.getByTestId('osk-key-done').click();
    await expect(page.getByTestId('card-smoketest-search')).toBeVisible();
    await expect(page.getByTestId('osk')).toBeVisible();
  });
});

test.describe('Фаза 4: фоновое аудио (Wake Lock + аудио-режим)', () => {
  test('аудио-режим скрывает видео, wake lock запрашивается и отпускается на паузе', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        get: () => ({
          request: async () => {
            const w = window as unknown as { __wlReq?: number; __wlRelease?: number };
            w.__wlReq = (w.__wlReq ?? 0) + 1;
            return {
              release: async () => {
                const w2 = window as unknown as { __wlRelease?: number };
                w2.__wlRelease = (w2.__wlRelease ?? 0) + 1;
              },
            };
          },
        }),
      });
    });
    await mockPlayerApi(page);

    await page.goto('/#/settings');
    const audioRow = page.locator('text=Фоновый аудио-режим').locator('..');
    await audioRow.getByRole('button', { name: 'Вкл' }).click();
    await expect(audioRow.getByRole('button', { name: 'Вкл' })).toHaveClass(/sky/);

    await page.goto('/#/watch/audio-1');
    await expect(page.getByTestId('player-title')).toHaveText('Демо-видео audio-1');
    await waitVideoPlaying(page);
    await expect(page.getByTestId('audio-mode-cover')).toBeVisible();

    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __wlReq?: number }).__wlReq ?? 0))
      .toBeGreaterThan(0);

    // пауза → wake lock отпущен (контролы видны при group-hover)
    await page.getByTestId('player-overlay').hover();
    await page.getByTestId('btn-play').click();
    await expect.poll(async () => page.evaluate(() => document.querySelector('video')?.paused)).toBe(true);
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __wlRelease?: number }).__wlRelease ?? 0))
      .toBeGreaterThan(0);

    // выключили режим → обложка пропала
    await page.goto('/#/settings');
    await audioRow.getByRole('button', { name: 'Выкл' }).click();
    await page.goto('/#/watch/audio-1');
    await expect(page.getByTestId('audio-mode-cover')).toHaveCount(0);
  });
});

test.describe('Фаза 4: pairing «Смотреть на ТВ»', () => {
  interface PairState {
    queued: string[];
  }

  async function mockPairingApi(page: Page, state: PairState) {
    await page.route('**/api/v1/pairing/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          code: 'AB34CD',
          verificationUrl: 'http://localhost:5173/#/pairing/AB34CD',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          mode: 'local',
          paired: false,
        }),
      });
    });
    await page.route('**/api/v1/pairing/poll**', async (route) => {
      const commands = state.queued.map((videoId, i) => ({
        kind: 'play' as const,
        videoId,
        ts: Date.now() + i,
      }));
      state.queued.length = 0;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          paired: commands.length > 0,
          deviceName: commands.length ? 'Телефон' : undefined,
          commands,
        }),
      });
    });
    await page.route('**/api/v1/pairing/status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, code: 'AB34CD', paired: true, deviceName: 'Телефон', mode: 'local' }),
      });
    });
    await page.route('**/api/v1/pairing/send', async (route) => {
      const body = (await route.request().postDataJSON()) as { videoId?: string };
      const raw = body.videoId ?? '';
      const m = raw.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ?? raw.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
      const id = m?.[1] ?? (/^[A-Za-z0-9_-]{6,}$/.test(raw) ? raw : null);
      if (!id) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'Некорректная ссылка или id видео' }),
        });
        return;
      }
      state.queued.push(id);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
  }

  test('код на ТВ, отправка с телефона, запуск видео на ТВ', async ({ page }) => {
    const state: PairState = { queued: [] };
    await mockPlayerApi(page);
    await mockPairingApi(page, state);

    await page.goto('/#/pairing');
    await expect(page.getByTestId('pairing-page')).toBeVisible();
    const code = (await page.getByTestId('pairing-code').textContent())?.trim() ?? '';
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    await expect(page.getByTestId('pairing-verify')).toContainText(code);

    // «телефон» открывает ссылку с кодом и отправляет ссылку YouTube
    const phone = await page.context().newPage();
    await mockPairingApi(phone, state);
    await phone.goto(`/#/pairing/${code}`);
    await expect(phone.getByTestId('pairing-target-code')).toHaveText(code);
    await phone.getByTestId('pairing-send-input').fill('https://youtu.be/dQw4w9WgXcQ');
    await phone.getByTestId('btn-pairing-send').click();
    await expect(phone.getByTestId('pairing-send-result')).toContainText('Отправлено');
    await phone.close();

    // ТВ забирает команду из очереди и переходит к просмотру
    await page.waitForURL(/\/watch\//, { timeout: 15_000 });
    await expect(page.getByTestId('player-title')).toBeVisible();
    await expect(page.getByTestId('player-title')).toContainText('dQw4w9WgXcQ');
  });

  test('неверная ссылка → ошибка на странице телефона', async ({ page }) => {
    const state: PairState = { queued: [] };
    await mockPairingApi(page, state);

    await page.goto('/#/pairing/AB34CD');
    await page.getByTestId('pairing-send-input').fill('это не ссылка');
    await page.getByTestId('btn-pairing-send').click();
    await expect(page.getByTestId('pairing-send-result')).toContainText('Некорректная');
    expect(state.queued.length).toBe(0);
  });
});