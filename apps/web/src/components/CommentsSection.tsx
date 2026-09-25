import { useEffect, useRef, useState } from 'react';
import type { CommentInfo } from '@stfw/shared';
import { fetchComments, fetchCommentsNext } from '../api';
import { useApp } from '../store';
import { Loading, SentinalHolder } from './FeedUI';
import { useInfiniteScroll } from '../useInfiniteScroll';
import { useTvNavigation } from '../tvnav';

interface Props {
  videoId: string;
}

export function CommentsSection({ videoId }: Props) {
  const gl = useApp((s) => s.settings.gl);
  const [list, setList] = useState<CommentInfo[]>([]);
  const [cont, setCont] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  const srcRef = useRef(videoId);
  srcRef.current = videoId;

  useEffect(() => {
    let cancelled = false;
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    setList([]);
    setCont(undefined);
    fetchComments(videoId, gl)
      .then((r) => {
        if (cancelled || gen !== genRef.current) return;
        setList(r.comments);
        setCont(r.continuation);
      })
      .catch((e: Error) => {
        if (!cancelled && gen === genRef.current) setError(e.message);
      })
      .finally(() => {
        if (!cancelled && gen === genRef.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId, gl]);

  const loadMore = async () => {
    if (!cont || busy) return;
    const gen = genRef.current;
    setBusy(true);
    try {
      const r = await fetchCommentsNext(cont);
      if (gen !== genRef.current) return;
      setList((prev) => [...prev, ...r.comments]);
      setCont(r.continuation);
    } catch {
      if (gen === genRef.current) setCont(undefined);
    } finally {
      if (gen === genRef.current) setBusy(false);
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  const sentinel = useInfiniteScroll(loadMore, !!cont);

  return (
    <div ref={containerRef} className="mt-8">
      <h2 className="mb-3 text-lg font-semibold" data-testid="comments-title">
        Комментарии {list.length > 0 ? `(${list.length})` : ''}
      </h2>

      {error ? (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
          Комментарии сейчас недоступны: {error}
        </div>
      ) : null}

      {loading ? <Loading /> : null}

      {!loading && !error && list.length === 0 ? (
        <p className="text-sm text-white/40">Комментариев пока нет.</p>
      ) : null}

      <div className="flex flex-col gap-4">
        {list.map((c) => (
          <div key={c.id || `${c.author.name}-${c.content.slice(0, 20)}`} data-testid="comment-item" className="flex gap-3">
            {c.avatarUrl ? (
              <img
                src={c.avatarUrl}
                alt=""
                loading="lazy"
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="h-9 w-9 shrink-0 rounded-full bg-[#222] text-center text-sm leading-9">
                {c.author.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-white/50">
                <span className="font-medium text-white/80" data-testid="comment-author">
                  {c.author.name}
                </span>
                {c.isPinned ? <span className="rounded bg-white/10 px-1.5 py-0.5">📌 закреплён</span> : null}
                {c.publishedTime ? <span>{c.publishedTime}</span> : null}
              </div>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-white/90" data-testid="comment-content">
                {c.content}
              </p>
              <div className="mt-1 text-xs text-white/40">
                {c.likeCount ? `👍 ${c.likeCount}` : ''}
                {c.replyCount ? ` · ${c.replyCount} ответов` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {busy ? <Loading /> : null}
      <SentinalHolder ref={sentinel} />
    </div>
  );
}