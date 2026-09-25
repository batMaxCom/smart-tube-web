import { useEffect, useRef, useState } from 'react';
import type { LiveChatMessageItem } from '@stfw/shared';
import { chatPoll, chatStart } from '../api';

const MAX_SHOWN = 300;

export function LiveChatPanel({ videoId }: { videoId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<LiveChatMessageItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const msgsRef = useRef<LiveChatMessageItem[]>([]);
  const afterRef = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    msgsRef.current = [];
    afterRef.current = 0;
    setMessages([]);
    setAvailable(null);
    setError(null);

    const doPoll = async () => {
      try {
        const d = await chatPoll(videoId, afterRef.current);
        if (cancelled) return;
        if (d.messages.length) {
          const merged = [...msgsRef.current, ...d.messages];
          msgsRef.current = merged.slice(-MAX_SHOWN);
          setMessages(msgsRef.current);
        }
        afterRef.current = d.after;
      } catch {
        /* следующая итерация */
      }
    };

    chatStart(videoId)
      .then((d) => {
        if (cancelled) return;
        if (!d.available) {
          setAvailable(false);
          setError(d.error ?? 'Чат недоступен для этого видео');
          return;
        }
        msgsRef.current = d.messages;
        afterRef.current = d.after;
        setMessages(d.messages);
        setAvailable(true);
        timer = window.setInterval(doPoll, 4000);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setAvailable(false);
        setError(e.message);
      });

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [videoId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  return (
    <div className="rounded-xl bg-[#181818] p-4" data-testid="chat-panel">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold">Live-чат</h2>
        {available === true ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            в прямом эфире
          </span>
        ) : null}
      </div>

      {available === null ? (
        <p className="text-sm text-white/40">Подключаемся к чату…</p>
      ) : available === false ? (
        <p className="text-sm text-white/40" data-testid="chat-unavailable">
          {error ?? 'Чат недоступен'}
        </p>
      ) : (
        <ul
          ref={listRef}
          className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1"
          data-testid="chat-messages"
        >
          {messages.length === 0 ? (
            <li className="text-sm text-white/40">Сообщений пока нет</li>
          ) : (
            messages.map((m) => (
              <li
                key={m.id}
                data-testid="chat-message"
                className="rounded-lg bg-white/5 px-3 py-2"
              >
                <span className="mr-2 text-xs font-semibold text-sky-300" data-testid="chat-author">
                  {m.author.name}
                </span>
                <span className="text-sm text-white/90" data-testid="chat-text">
                  {m.kind === 'membership' ? `💎 ${m.text}` : m.kind === 'paid' ? `💛 ${m.text}` : m.text}
                </span>
                {m.author.isOwner ? <span className="ml-1 text-xs text-red-400">(владелец)</span> : null}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}