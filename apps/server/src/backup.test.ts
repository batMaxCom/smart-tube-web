import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'stfw-backup-'));
process.env.STFW_DATA_DIR = dir;
const { getBackup, saveBackup } = await import('./backup.js');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('backup', () => {
  it('save без кода генерирует код; get возвращает ту же копию', async () => {
    const res = await saveBackup(undefined, { settings: { theme: 'dark' }, history: [1, 2] });
    expect(res.ok).toBe(true);
    expect(res.code).toMatch(/^[A-Z2-9]{6}$/);
    const doc = await getBackup(res.code!);
    expect(doc?.kind).toBe('stfw-backup');
    expect(doc?.data).toEqual({ settings: { theme: 'dark' }, history: [1, 2] });
    expect(doc?.savedAt).toBeGreaterThan(0);
  });

  it('save с заданным кодом — регистронезависимый get', async () => {
    await saveBackup('ABC123', { settings: { lang: 'ru' } });
    const doc = await getBackup('abc123');
    expect(doc?.data).toEqual({ settings: { lang: 'ru' } });
  });

  it('несуществующий код → undefined', async () => {
    expect(await getBackup('ZZZZZZ')).toBeUndefined();
  });
});