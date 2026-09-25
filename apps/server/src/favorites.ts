import type { FavoriteItem, FavoritesResponse } from '@stfw/shared';
import { dataDir } from './creds.js';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Локальное «избранное» (файл data/favorites.json). Реальная синхронизация
 * с плейлистом аккаунта — best-effort на будущее; здесь фокус на детерминизме
 * и офлайн-работе.
 */

const FAV_PATH = join(dataDir(), 'favorites.json');

let favorites: FavoriteItem[] | null = null;

async function load(): Promise<FavoriteItem[]> {
  if (favorites) return favorites;
  try {
    const raw = await readFile(FAV_PATH, 'utf8');
    favorites = (JSON.parse(raw) as { items?: FavoriteItem[] }).items ?? [];
  } catch {
    favorites = [];
  }
  return favorites;
}

async function persist(list: FavoriteItem[]): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dirname(FAV_PATH), { recursive: true });
  await writeFile(FAV_PATH, `${JSON.stringify({ items: list }, null, 2)}\n`, 'utf8');
  favorites = list;
}

export async function listFavorites(): Promise<FavoritesResponse> {
  return { items: (await load()).slice(0, 500) };
}

export async function addFavorite(item: FavoriteItem): Promise<FavoritesResponse> {
  const list = (await load()).filter((f) => f.id !== item.id);
  list.unshift(item);
  await persist(list);
  return { items: list.slice(0, 500) };
}

export async function removeFavorite(id: string): Promise<FavoritesResponse> {
  const list = (await load()).filter((f) => f.id !== id);
  await persist(list);
  return { items: list.slice(0, 500) };
}

export async function clearFavorites(): Promise<FavoritesResponse> {
  await persist([]);
  return { items: [] };
}