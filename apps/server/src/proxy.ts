import { randomUUID } from 'node:crypto';

export type ProxyKind = 'media' | 'asset';

type ProxyEntry = {
  kind: ProxyKind;
  url: string;
  expiresAt: number;
};

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 20_000;
const entries = new Map<string, ProxyEntry>();
const targetTokens = new Map<string, string>();

function prune(): void {
  const now = Date.now();
  for (const [token, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(token);
      targetTokens.delete(`${entry.kind}:${entry.url}`);
    }
  }
}

function isHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isAllowedTarget(value: string, kind: ProxyKind): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (kind === 'media') return isHost(hostname, 'googlevideo.com');
  return ['ytimg.com', 'ggpht.com', 'googleusercontent.com'].some((domain) =>
    isHost(hostname, domain),
  );
}

function pathFor(kind: ProxyKind, token: string): string {
  return `/api/v1/${kind === 'media' ? 'stream' : 'asset'}/${token}`;
}

export function registerProxyUrl(value: string | undefined, kind: ProxyKind): string | undefined {
  if (!value || !isAllowedTarget(value, kind)) return undefined;
  prune();
  const target = new URL(value).toString();
  const targetKey = `${kind}:${target}`;
  const existingToken = targetTokens.get(targetKey);
  if (existingToken) {
    const existing = entries.get(existingToken);
    if (existing && existing.expiresAt > Date.now()) return pathFor(kind, existingToken);
    entries.delete(existingToken);
    targetTokens.delete(targetKey);
  }
  const token = randomUUID();
  while (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (!oldest) break;
    const old = entries.get(oldest);
    entries.delete(oldest);
    if (old) targetTokens.delete(`${old.kind}:${old.url}`);
  }
  entries.set(token, { kind, url: target, expiresAt: Date.now() + TTL_MS });
  targetTokens.set(targetKey, token);
  return pathFor(kind, token);
}

export function resolveProxyToken(token: string, kind: ProxyKind): string | undefined {
  prune();
  const entry = entries.get(token);
  if (!entry || entry.kind !== kind) return undefined;
  return entry.url;
}

export function clearProxyRegistry(): void {
  entries.clear();
  targetTokens.clear();
}

function externalUrlKind(value: string): ProxyKind | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return undefined;
    const hostname = parsed.hostname.toLowerCase();
    if (isHost(hostname, 'googlevideo.com')) return 'media';
    if (
      ['ytimg.com', 'ggpht.com', 'googleusercontent.com'].some((domain) => isHost(hostname, domain))
    ) {
      return 'asset';
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function localizeUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => localizeUrls(item));
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'verificationUrl') {
      result[key] = item;
    } else if ((key === 'url' || key === 'avatarUrl') && typeof item === 'string') {
      const kind = externalUrlKind(item);
      result[key] = kind ? (registerProxyUrl(item, kind) ?? item) : item;
    } else {
      result[key] = localizeUrls(item);
    }
  }
  return result;
}
