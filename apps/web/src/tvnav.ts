import { useEffect, useRef } from 'react';
import { useApp } from './store';

/**
 * Базовая TV/DPAD-навигация: roving focus по элементам с [data-focus].
 * Стрелки — пространственная навигация по геометрии (наилучший результат для грида).
 * Enter/Space — клик, Escape/Backspace — назад.
 */

const FOCUSABLE = '[data-focus]';

export function getFocusables(container: HTMLElement | null | undefined): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true' && el.style.display !== 'none',
  );
}

export function focusByIndex(items: HTMLElement[], index: number): HTMLElement | undefined {
  if (items.length === 0) return undefined;
  const idx = ((index % items.length) + items.length) % items.length;
  const el = items[idx];
  el?.focus();
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return el;
}

function findNext(
  items: HTMLElement[],
  current: HTMLElement | null,
  axis: 'x' | 'y',
  dir: 1 | -1,
): HTMLElement | undefined {
  const cur = current ?? (document.activeElement as HTMLElement | null);
  if (!cur) return items[0];
  const rect = cur.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const candidates = items.filter((el) => {
    const r = el.getBoundingClientRect();
    if (axis === 'x') return dir === 1 ? r.left > rect.right : r.right < rect.left;
    return dir === 1 ? r.top > rect.bottom : r.bottom < rect.top;
  });

  if (candidates.length === 0) return undefined;

  const score = (el: HTMLElement): number => {
    const r = el.getBoundingClientRect();
    const ecx = r.left + r.width / 2;
    const ecy = r.top + r.height / 2;
    const dx = ecx - cx;
    const dy = ecy - cy;
    // по вторичной оси — чем ближе, тем лучше; по главной — наименьшее (но строго в нужную сторону)
    return axis === 'x' ? Math.abs(dy) + Math.abs(dx) * 2 : Math.abs(dx) + Math.abs(dy) * 2;
  };
  candidates.sort((a, b) => score(a) - score(b));
  return candidates[0];
}

export function useTvNavigation(containerRef: React.RefObject<HTMLElement | null>) {
  const goBackRef = useRef<() => void>(() => {});
  goBackRef.current = useApp.getState().goBack;

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    const isTyping = () =>
      document.activeElement?.matches('input, textarea, [contenteditable="true"]');

    const isRange = () =>
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type === 'range';

    const onKeyDown = (e: KeyboardEvent) => {
      // навигация на пульте ТВ
      let handled = false;

      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp'
      ) {
        if (isTyping() || isRange()) return; // не перехватываем ввод в текстовом поле и слайдерах
        const items = getFocusables(container);
        if (items.length === 0) return;
        const active = document.activeElement as HTMLElement | null;
        const axis = e.key === 'ArrowRight' || e.key === 'ArrowLeft' ? 'x' : 'y';
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const next = findNext(items, active, axis as 'x' | 'y', dir as 1 | -1);
        if (next) {
          next.focus();
          next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          handled = true;
        } else if (e.key === 'ArrowUp') {
          // упёрлись вверх — показываем шапку/начало
          container.scrollIntoView({ block: 'start', behavior: 'smooth' });
          handled = true;
        }
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        const vh = window.innerHeight;
        window.scrollBy({ top: (e.key === 'PageDown' ? 1 : -1) * vh * 0.8, behavior: 'smooth' });
        handled = true;
      } else if (e.key === 'End' || e.key === 'Home') {
        const scroller = document.scrollingElement ?? document.documentElement;
        scroller.scrollTo({ top: e.key === 'End' ? scroller.scrollHeight : 0, behavior: 'smooth' });
        if (e.key === 'Home') {
          const first = getFocusables(container)[0];
          first?.focus();
        }
        handled = true;
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (isTyping()) return;
        const active = document.activeElement as HTMLElement | null;
        if (active && active.hasAttribute('data-focus')) {
          active.click();
          handled = true;
        }
      } else if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack') {
        if (isTyping() && e.key === 'Backspace') {
          // в input Backspace — редактирование; Escape — выход из поиска
          return;
        }
        handled = true;
        goBackRef.current();
      }

      if (handled) e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [containerRef]);

  return containerRef;
}

/** Фокусируется и подсвечивает первую карточку при монтировании. */
export function useInitialFocus(
  containerRef: React.RefObject<HTMLElement | null>,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const t = setTimeout(() => {
      const items = getFocusables(containerRef.current);
      if (items.length) items[0]?.focus();
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
