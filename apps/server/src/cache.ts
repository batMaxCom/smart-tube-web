/** Простой in-memory TTL-кэш (для снижения нагрузки на YouTube и скорости ответов). */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.map.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
  }

  clear(): void {
    this.map.clear();
  }
}
