import { useRef } from 'react';
import { useApp } from '../store';
import { Empty } from '../components/FeedUI';
import { useInitialFocus, useTvNavigation } from '../tvnav';

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function HistoryPage() {
  const history = useApp((s) => s.history);
  const navigate = useApp((s) => s.navigate);
  const clearHistory = useApp((s) => s.clearHistory);

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef, [history]);

  return (
    <div ref={containerRef} className="mx-auto max-w-[1200px] px-4 py-4">
      <div className="mb-4 flex items-center justify-between px-1">
        <h1 className="text-2xl font-semibold">История (на этом устройстве)</h1>
        {history.length > 0 ? (
          <button
            type="button"
            data-focus
            className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20"
            onClick={clearHistory}
          >
            Очистить
          </button>
        ) : null}
      </div>
      {history.length === 0 ? (
        <Empty text="Пока ничего не смотрели — история появится после открытия видео" />
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((h) => (
            <button
              key={h.id}
              type="button"
              data-focus
              data-testid={`history-${h.id}`}
              className="flex items-center gap-3 rounded-xl bg-[#181818] p-3 text-left hover:bg-[#222]"
              onClick={() => navigate({ name: 'watch', id: h.id })}
            >
              <span className="min-w-0 flex-1 truncate text-sm">{h.title}</span>
              <span className="shrink-0 text-xs text-white/40">{fmtDate(h.ts)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}