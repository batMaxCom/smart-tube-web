import type { BackupDocument, BackupResult } from '@stfw/shared';
import { dataDir } from './creds.js';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Резервная копия / синхронизация по коду (как ID-based бэкап в SmartTube).
 * Хранится в data/backups.json: { CODE: BackupDocument }.
 */

const BACKUPS_PATH = join(dataDir(), 'backups.json');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let cache: Record<string, BackupDocument> | null = null;

async function load(): Promise<Record<string, BackupDocument>> {
  if (cache) return cache;
  try {
    const raw = await readFile(BACKUPS_PATH, 'utf8');
    cache = (JSON.parse(raw) as Record<string, BackupDocument>) ?? {};
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(list: Record<string, BackupDocument>): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dirname(BACKUPS_PATH), { recursive: true });
  await writeFile(BACKUPS_PATH, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  cache = list;
}

function generateCode(): string {
  let code = '';
  do {
    const bytes = randomBytes(6);
    code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  } while (cache?.[code]);
  return code;
}

/** Сохранить резервную копию под кодом (или сгенерировать новый). */
export async function saveBackup(code: string | undefined, data: Record<string, unknown>): Promise<BackupResult> {
  const store = await load();
  const finalCode = (code ?? generateCode()).toUpperCase();
  store[finalCode] = {
    kind: 'stfw-backup',
    version: 1,
    savedAt: Date.now(),
    data,
  };
  await persist(store);
  return { ok: true, code: finalCode };
}

/** Получить копию по коду (регистр не важен). */
export async function getBackup(code: string): Promise<BackupDocument | undefined> {
  const store = await load();
  return store[code.trim().toUpperCase()];
}