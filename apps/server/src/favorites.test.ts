import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'stfw-fav-'));
process.env.STFW_DATA_DIR = dir;
const { addFavorite, clearFavorites, listFavorites, removeFavorite } = await import('./favorites.js');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('favorites', () => {
  it('пусто при старте', async () => {
    expect(await listFavorites()).toEqual({ items: [] });
  });

  it('новые — в начало списка, дубликаты обновляются', async () => {
    await addFavorite({ id: 'vid-1', title: 'Первое', addedAt: 1 });
    await addFavorite({ id: 'vid-2', title: 'Второе', addedAt: 2 });
    await addFavorite({ id: 'vid-1', title: 'Первое (новая версия)', addedAt: 3 });

    const { items } = await listFavorites();
    expect(items.map((i) => i.id)).toEqual(['vid-1', 'vid-2']);
    expect(items[0].title).toBe('Первое (новая версия)');
    expect(items[0].addedAt).toBe(3);
  });

  it('remove убирает один элемент', async () => {
    await removeFavorite('vid-1');
    expect((await listFavorites()).items.map((i) => i.id)).toEqual(['vid-2']);
  });

  it('clear очищает всё', async () => {
    await clearFavorites();
    expect(await listFavorites()).toEqual({ items: [] });
  });
});