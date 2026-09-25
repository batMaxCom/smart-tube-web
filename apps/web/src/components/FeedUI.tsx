import { forwardRef } from 'react';

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
      {message}
    </div>
  );
}

export function Loading() {
  return <p className="py-6 text-center text-sm text-white/40">Загрузка…</p>;
}

export function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-white/40">{text}</p>;
}

/** Невидимый «маяк» для IntersectionObserver (бесконечный скролл). */
export const SentinalHolder = forwardRef<HTMLDivElement, { className?: string }>(
  function SentinalHolder({ className }, ref) {
    return <div ref={ref} aria-hidden="true" className={`h-px w-px ${className ?? ''}`} />;
  },
);