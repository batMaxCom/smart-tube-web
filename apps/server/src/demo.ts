import type { DemoMode } from '@stfw/shared';

/** Разрешает режим демо-контента из env (DEMO_MODE=auto|1|0). */
export function resolveDemoMode(env: string | undefined): DemoMode {
  if (env === '1' || env === 'on' || env === 'true' || env === 'yes') return 'on';
  if (env === '0' || env === 'off' || env === 'false' || env === 'no') return 'off';
  return 'auto';
}

export interface DemoDecision {
  /** true — отдавать демо-манифест. */
  useDemo: boolean;
  /** Причина выбора демо (для логирования). */
  reason: 'forced' | 'botgate' | 'unreachable' | 'none';
}

/**
 * Нужно ли отдать демо-манифест в зависимости от режима и состояния YouTube.
 * - on: демо всегда.
 * - off: демо никогда (поток будет реальным либо вернётся ошибка).
 * - auto: демо, если с IP не пришли URL форматов (бот-гейт) или YouTube недоступен.
 */
export function decideDemo(
  mode: DemoMode,
  liveAvailable: boolean,
  unreachable: boolean,
): DemoDecision {
  switch (mode) {
    case 'on':
      return { useDemo: true, reason: 'forced' };
    case 'off':
      return { useDemo: false, reason: 'none' };
    default:
      if (!liveAvailable) return { useDemo: true, reason: 'botgate' };
      if (unreachable) return { useDemo: true, reason: 'unreachable' };
      return { useDemo: false, reason: 'none' };
  }
}