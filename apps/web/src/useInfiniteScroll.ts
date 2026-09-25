import { useEffect, useRef } from 'react';

/**
 * Бесконечный скролл: вызывает onNeeded, когда sentinel уходит в поле зрения.
 * Страница сама управляет защитой от повторных вызовов (busyRef) внутри onNeeded.
 */
export function useInfiniteScroll(onNeeded: () => void, enabled: boolean) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onNeededRef = useRef(onNeeded);
  onNeededRef.current = onNeeded;

  useEffect(() => {
    if (!enabled) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onNeededRef.current();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  return sentinelRef;
}