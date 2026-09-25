import { randomBytes } from 'node:crypto';
import type { PairingCommand } from '@stfw/shared';

/**
 * «Смотреть на ТВ»: command-channel привязки телефона к ТВ по короткому коду.
 * Телефон открывает ссылку с кодом и HTTP-запросом шлёт команду play;
 * ТВ забирает команды длинным поллингом. (YouTube lounge-протокол с домашнего
 * IP недоступен под бот-гейтом — здесь полноценный локальный канал, единый
 * для любой сети, включая дата-центр.)
 */

export interface PairingSession {
  code: string;
  screenId: string;
  verificationUrl: string;
  mode: 'local';
  paired: boolean;
  deviceName?: string;
  /** epoch ms, когда истекает код. */
  expiresAt: number;
  commands: PairingCommand[];
}

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const MAX_COMMANDS = 50;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode(length = 6): string {
  const bytes = randomBytes(length);
  let s = '';
  for (let i = 0; i < length; i += 1) s += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return s;
}

export class PairingCenter {
  private sessions = new Map<string, PairingSession>();

  constructor(private ttlMs = PAIRING_TTL_MS) {}

  private prune(): void {
    const now = Date.now();
    for (const [code, s] of this.sessions) {
      if (s.expiresAt < now) this.sessions.delete(code);
    }
  }

  /** Текущий живой код (устаревшие сессии вычищаются). */
  code(): string {
    this.prune();
    let code = '';
    do {
      code = generateCode();
    } while (this.sessions.has(code));
    return code;
  }

  create(verificationUrl: string): PairingSession {
    const code = this.code();
    const s: PairingSession = {
      code,
      screenId: `ST${generateCode(12)}`,
      verificationUrl,
      mode: 'local',
      paired: false,
      expiresAt: Date.now() + this.ttlMs,
      commands: [],
    };
    this.sessions.set(code, s);
    return s;
  }

  private live(code: string): PairingSession | undefined {
    this.prune();
    const s = this.sessions.get(code);
    return s;
  }

  get(code: string): PairingSession | undefined {
    return this.live(code);
  }

  unique(code: string): Pick<PairingSession, 'code' | 'screenId' | 'verificationUrl' | 'mode' | 'paired' | 'deviceName' | 'expiresAt'> | undefined {
    const s = this.live(code);
    if (!s) return undefined;
    return {
      code: s.code,
      screenId: s.screenId,
      verificationUrl: s.verificationUrl,
      mode: s.mode,
      paired: s.paired,
      deviceName: s.deviceName,
      expiresAt: s.expiresAt,
    };
  }

  markPaired(code: string, deviceName?: string): boolean {
    const s = this.live(code);
    if (!s) return false;
    s.paired = true;
    if (deviceName) s.deviceName = deviceName;
    return true;
  }

  /** Доставить команду на ТВ по коду (телефон → ТВ). */
  send(code: string, command: PairingCommand): boolean {
    const s = this.live(code);
    if (!s) return false;
    if (s.commands.length >= MAX_COMMANDS) s.commands.shift();
    s.commands.push(command);
    return true;
  }

  /** Забрать команды ТВ (поллинг). */
  drain(code: string): PairingCommand[] {
    const s = this.live(code);
    if (!s) return [];
    return s.commands.splice(0, s.commands.length);
  }

  disconnect(code: string): void {
    this.sessions.delete(code);
  }
}

export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m =
    s.match(/(?:youtu\.be\/|\/watch\?v=|\/shorts\/|\/embed\/)[A-Za-z0-9_-]{6,}/i) ??
    s.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (m) {
    const found = m[0].match(/[A-Za-z0-9_-]{6,}$/)?.[0];
    if (found) return found;
  }
  if (/^[A-Za-z0-9_-]{6,}$/.test(s)) return s;
  return null;
}