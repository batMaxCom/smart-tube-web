import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OAuth2Tokens } from 'youtubei.js';

/**
 * Хранилище OAuth-токенов аккаунта (динсковый файл). Вынесено в отдельный
 * модуль, чтобы yt.ts и auth.ts не зацикливались импортами.
 */

const DATA_DIR = process.env.STFW_DATA_DIR ?? join(process.cwd(), 'data');
const CRED_PATH = join(DATA_DIR, 'credentials.json');

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function loadTokens(): Promise<OAuth2Tokens | null> {
  const tokens = await readJson<OAuth2Tokens | null>(CRED_PATH, null);
  if (!tokens || typeof tokens.access_token !== 'string' || !tokens.refresh_token) return null;
  return tokens;
}

export async function saveTokens(tokens: OAuth2Tokens): Promise<void> {
  await writeJson(CRED_PATH, tokens);
}

export async function clearTokens(): Promise<void> {
  try {
    await rm(CRED_PATH, { force: true });
  } catch {
    /* файла нет — не страшно */
  }
}

export function dataDir(): string {
  return DATA_DIR;
}