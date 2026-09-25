import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PlayerResponse,
  RelatedResponse,
  VideoCodec,
  VideoFormat,
} from '@stfw/shared';
import {
  addFavorite,
  engage,
  fetchNext,
  fetchPlayer,
  fetchRelated,
  formatViews,
  manifestUrl,
  PLAYER_RATES,
  removeFavorite,
} from '../api';
import { useApp } from '../store';
import { ShakaVideo, type ShakaVideoHandle } from '../components/ShakaVideo';
import { PlayerControls, type PlayerUiState } from '../components/PlayerControls';
import { CommentsSection } from '../components/CommentsSection';
import { LiveChatPanel } from '../components/LiveChatPanel';
import { FeedGrid } from '../components/FeedGrid';
import { Loading } from '../components/FeedUI';
import { useTvNavigation } from '../tvnav';

const CODEC_NAME: Record<VideoCodec, string> = { avc: 'H.264', vp9: 'VP9', av01: 'AV1' };

interface RelatedState extends RelatedResponse {
  error?: string;
}

export function PlayerPage({ id }: { id: string }) {
  const navigate = useApp((s) => s.navigate);
  const settings = useApp((s) => s.settings);
  const setCodec = useApp((s) => s.setCodec);
  const setMaxHeight = useApp((s) => s.setMaxHeight);
  const pushHistory = useApp((s) => s.pushHistory);
  const error = useApp((s) => s.error);
  const setError = useApp((s) => s.setError);
  const signedIn = useApp((s) => s.account.signedIn);

  const [data, setData] = useState<PlayerResponse | null>(null);
  const handle = useRef<ShakaVideoHandle | null>(null);
  const [rate, setRate] = useState(1);
  const [qOpen, setQOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [rating, setRating] = useState<'none' | 'like' | 'dislike'>('none');
  const [faved, setFaved] = useState(false);
  const [ui, setUi] = useState<PlayerUiState>({
    playing: false,
    currentTime: 0,
    duration: 0,
    bufferedEnd: 0,
    isFullscreen: false,
    isPip: false,
    rate: 1,
    muted: false,
    volume: 1,
    hasText: false,
    textVisible: false,
  });
  const [autoBlocked, setAutoBlocked] = useState(false);
  const [related, setRelated] = useState<RelatedState | null>(null);
  const [pipSupported] = useState(
    () => typeof document !== 'undefined' && !!document.pictureInPictureEnabled,
  );

  // Wake Lock: держим воспроизведение при «выключенном» экране в аудио-режиме
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    const wl = (
      navigator as Navigator & {
        wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> };
      }
    ).wakeLock;
    const want = settings.audioMode && ui.playing;
    let cancelled = false;
    const request = async () => {
      if (!wl || wakeRef.current || !document.visibilityState || document.visibilityState === 'hidden') return;
      try {
        const s = await wl.request('screen');
        if (cancelled) {
          s.release().catch(() => undefined);
          return;
        }
        wakeRef.current = s;
      } catch {
        /* wake lock недоступен в этом контексте */
      }
    };
    const release = () => {
      if (wakeRef.current) {
        wakeRef.current.release().catch(() => undefined);
        wakeRef.current = null;
      }
    };
    if (want) void request();
    else release();
    const onVis = () => {
      // wake lock автоматически снимается при скрытии — восстанавливаем
      if (document.visibilityState === 'visible' && want && !wakeRef.current) void request();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      release();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [settings.audioMode, ui.playing]);

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    setRelated(null);
    fetchPlayer(id)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (d.id) pushHistory(d.id, d.title || d.id);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, setError, pushHistory]);

  // рекомендации
  useEffect(() => {
    let cancelled = false;
    fetchRelated(id)
      .then((d) => !cancelled && setRelated(d))
      .catch((e: Error) => !cancelled && setRelated({ items: [], error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // демо-режим и (не)доступность рекомов: не отправляем таймер сгорания
  const loadMoreRecs = async () => {
    if (!related?.continuation) return;
    try {
      const r = await fetchNext('related', related.continuation);
      setRelated((prev) =>
        prev
          ? { ...prev, items: [...prev.items, ...r.items], continuation: r.continuation }
          : prev,
      );
    } catch {
      setRelated((prev) => (prev ? { ...prev, continuation: undefined } : prev));
    }
  };

  // автопереход к «следующему» (up next), как в SmartTube
  const onEnded = useCallback(() => {
    if (!settings.autoplayNext) return;
    const up = related?.upNext;
    if (up?.id) navigate({ name: 'watch', id: up.id });
  }, [settings.autoplayNext, related?.upNext, navigate]);

  const onSponsorSkip = useCallback((msg: string) => {
    setToast(msg);
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, []);

  // Media Session: метаданные и мультимедийные клавиши/клипы в системном «сейчас играет»
  useEffect(() => {
    if (!data || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const thumb = data.thumbnails?.[data.thumbnails.length - 1];
    ms.metadata = new MediaMetadata({
      title: data.title || data.id,
      artist: data.author?.name || 'SmartTube WEB',
      album: 'SmartTube WEB',
      artwork: thumb?.url ? [{ src: thumb.url, sizes: `${thumb.width}x${thumb.height}` }] : [],
    });
    const safeSet = (action: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, h);
      } catch {
        /* действие не поддерживается — пропускаем */
      }
    };
    const goUpNext = () => {
      const up = related?.upNext;
      if (up?.id) navigate({ name: 'watch', id: up.id });
    };
    safeSet('play', () => handle.current?.play());
    safeSet('pause', () => handle.current?.pause());
    safeSet('previoustrack', (d) => {
      const h = handle.current;
      if (h) h.seekTo(Math.max(0, h.getCurrentTime() - (d.seekOffset ?? 10)));
    });
    safeSet('nexttrack', goUpNext);
    safeSet('seekbackward', (d) => {
      const h = handle.current;
      if (h) h.seekTo(Math.max(0, h.getCurrentTime() - (d.seekOffset ?? 10)));
    });
    safeSet('seekforward', (d) => {
      const h = handle.current;
      if (h) h.seekTo(h.getCurrentTime() + (d.seekOffset ?? 10));
    });
    return () => {
      for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward'])
        safeSet(a as MediaSessionAction, null);
      ms.metadata = null;
    };
  }, [data, related?.upNext, navigate]);

  // Media Session: позиция воспроизведения (прогресс-бар ОС)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (!ui.duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: ui.duration,
        playbackRate: ui.rate,
        position: Math.min(ui.currentTime, ui.duration),
      });
    } catch {
      /* positionState ещё не активировался */
    }
  }, [ui.currentTime, ui.duration, ui.rate]);

  const heights = useMemo(() => {
    const set = new Set<number>();
    for (const f of data?.formats ?? []) {
      if (f.hasVideo && !f.isProtected && f.url && f.height) set.add(f.height);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [data]);

  const selectedHeight = settings.maxHeight
    ? (heights.find((h) => h <= settings.maxHeight) ?? settings.maxHeight)
    : 0;

  const src =
    data && data.manifestPath && data.demo
      ? data.manifestPath
      : data && data.manifestPath
        ? manifestUrl(data.id, {
            codec: settings.codec,
            maxHeight: selectedHeight ? String(selectedHeight) : undefined,
          })
        : undefined;

  /** Группы реальных потоков для HQ-диалога: label → варианты форматов. */
  const formatGroups = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; height?: number; formats: VideoFormat[] }
    >();
    for (const f of data?.formats ?? []) {
      if (!f.hasVideo || f.isProtected || !f.url) continue;
      const h = f.height ?? 0;
      const label = f.label || (h ? `${h}p` : `itag ${f.itag}`);
      const key = String(h || f.itag || label);
      const g = groups.get(key) ?? { label, height: h || undefined, formats: [] };
      if (!g.formats.some((x) => x.codecs === f.codecs)) g.formats.push(f);
      groups.set(key, g);
    }
    return Array.from(groups.values()).sort(
      (a, b) =>
        (b.height ?? 0) - (a.height ?? 0) ||
        (b.formats[0]?.bitrate ?? 0) - (a.formats[0]?.bitrate ?? 0),
    );
  }, [data]);

  const playableVideoCount = useMemo(
    () => (data?.formats ?? []).filter((f: VideoFormat) => f.hasVideo && !f.isProtected && f.url).length,
    [data],
  );

  const setSegment = (codec: VideoCodec, height: number) => {
    setCodec(codec);
    setMaxHeight(height);
    setQOpen(false);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  };

  const requireAccount = (): boolean => {
    if (signedIn) return true;
    showToast('Войдите в аккаунт, чтобы использовать: #/account');
    return false;
  };

  const setRatingNow = async (action: 'like' | 'dislike') => {
    if (!requireAccount() || !data) return;
    const target =
      rating === action ? ('none' as const) : action;
    try {
      const r = await engage({ videoId: data.id, action: target });
      if (r.ok) {
        setRating(target);
        showToast(
          target === 'none'
            ? 'Оценка снята'
            : target === 'like'
              ? 'Лайк поставлен'
              : 'Дизлайк поставлен',
        );
      } else if (r.reason === 'login_required') {
        showToast('Войдите в аккаунт, чтобы ставить оценки');
      } else {
        showToast('Не удалось поставить оценку');
      }
    } catch {
      showToast('Не удалось поставить оценку');
    }
  };

  const toggleFavorite = async () => {
    if (!requireAccount() || !data) return;
    try {
      if (faved) {
        await removeFavorite(data.id);
        setFaved(false);
        showToast('Убрано из избранного');
      } else {
        await addFavorite({ id: data.id, title: data.title || data.id, authorName: data.author?.name });
        setFaved(true);
        showToast('Добавлено в избранное');
      }
    } catch {
      showToast('Не удалось обновить избранное');
    }
  };

  return (
    <div ref={containerRef} className="mx-auto max-w-[1400px] px-4 py-4">
      {error ? (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</div>
      ) : null}

      {data?.playability !== 'ok' && data ? (
        <div className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
          Видео недоступно: {data.playabilityReason ?? data.playability}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="relative overflow-hidden rounded-xl">
            {src ? (
              <>
                <ShakaVideo
                  ref={handle}
                  manifestUrl={src}
                  videoId={data.demo ? undefined : data.id}
                  sponsorSkip={!data.demo}
                  onError={(m) => setError(m)}
                  onReady={({ duration }) => setUi((s) => ({ ...s, duration }))}
                  onTimeUpdate={({ currentTime, duration, bufferedEnd }) =>
                    setUi((s) => ({ ...s, currentTime, duration, bufferedEnd }))
                  }
                  onPlayState={(playing) => {
                    setUi((s) => ({ ...s, playing }));
                    if (playing) setAutoBlocked(false);
                    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
                      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
                    }
                  }}
                  onEnded={onEnded}
                  onFullscreenChange={(isFullscreen) => setUi((s) => ({ ...s, isFullscreen }))}
                  onPipChange={(isPip) => setUi((s) => ({ ...s, isPip }))}
                  onSponsorSkip={onSponsorSkip}
                  onAutoPlayBlocked={() => {
                    setUi((s) => ({ ...s, controls: true }));
                    setAutoBlocked(true);
                  }}
                />
                {settings.audioMode ? (
                  <div
                    className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/75"
                    data-testid="audio-mode-cover"
                  >
                    <div className="rounded-full bg-white/10 px-4 py-2 text-sm text-white/90">
                      🎧 Фоновый аудио-режим — звук играет, экран можно выключить
                    </div>
                  </div>
                ) : autoBlocked ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60" data-testid="autoplay-blocked">
                    <button
                      type="button"
                      data-focus
                      data-testid="btn-start"
                      className="flex items-center gap-3 rounded-full bg-white/10 px-6 py-3 text-lg text-white hover:bg-white/20"
                      onClick={() => handle.current?.play()}
                    >
                      <span className="text-2xl">▶</span> Нажмите Play
                    </button>
                  </div>
                ) : null}
                <PlayerControls
                  state={ui}
                  pipSupported={pipSupported}
                  onTogglePlay={() => handle.current?.toggle()}
                  onSeek={(t) => handle.current?.seekTo(t)}
                  onStep={(d) => {
                    const h = handle.current;
                    if (h) h.seekTo(h.getCurrentTime() + d);
                  }}
                  onRate={() => {
                    const next = PLAYER_RATES[(PLAYER_RATES.indexOf(rate) + 1) % PLAYER_RATES.length];
                    setRate(next);
                    handle.current?.setRate(next);
                    setUi((s) => ({ ...s, rate: next }));
                  }}
                  onVolume={(v) => {
                    handle.current?.setVolume(v);
                    setUi((s) => ({ ...s, volume: v, muted: v === 0 }));
                  }}
                  onToggleMute={() => {
                    const m = handle.current?.toggleMute();
                    setUi((s) => ({ ...s, muted: !!m }));
                  }}
                  onToggleSubs={() => {
                    const visible = handle.current?.toggleSubtitles();
                    if (visible !== undefined) {
                      setUi((s) => ({ ...s, hasText: true, textVisible: visible }));
                    }
                  }}
                  onToggleFullscreen={() => {
                    const h = handle.current;
                    if (!h) return;
                    if (h.isFullscreen()) h.exitFullscreen();
                    else h.enterFullscreen();
                  }}
                  onTogglePip={() => {
                    const h = handle.current;
                    if (!h) return;
                    if (h.isPip()) h.exitPip();
                    else h.enterPip();
                  }}
                />
              </>
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-black">
                <span className="text-white/40">Потоки для воспроизведения недоступны</span>
              </div>
            )}

            {toast ? (
              <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-lg bg-sky-600/90 px-3 py-1.5 text-xs text-white shadow-lg">
                {toast}
              </div>
            ) : null}
          </div>

          {data.demo && (
            <div className="mt-3 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
              <b>Демо-режим:</b> с IP сервера YouTube не отдаёт URL потоков (бот-гейт на датацентр).
              Показ идёт на тестовом DASH. На вашем сервере (домашний IP) будет включён реальный
              поток.
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold" data-testid="player-title">
                {data.title}
              </h1>
              <div className="mt-1 text-sm text-[#aaa]">
                {data.author?.name && (
                  <button
                    type="button"
                    data-focus
                    className="text-white/80 hover:text-white"
                    onClick={() =>
                      data.author?.id &&
                      navigate({ name: 'channel', id: data.author.id, tab: 'videos' })
                    }
                  >
                    {data.author.name}
                  </button>
                )}
                {data.viewCount ? (
                  <span> · {formatViews(data.viewCount)} просмотров</span>
                ) : null}
              </div>
              {data.description ? (
                <p className="mt-2 line-clamp-3 max-w-3xl text-sm text-white/70">
                  {data.description}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-focus
                  data-testid="btn-like"
                  className={`rounded-full px-4 py-1.5 text-sm ${
                    rating === 'like' ? 'bg-sky-600/80' : 'bg-white/10 hover:bg-white/20'
                  }`}
                  onClick={() => void setRatingNow('like')}
                >
                  Лайк {rating === 'like' ? '✓' : ''}
                </button>
                <button
                  type="button"
                  data-focus
                  data-testid="btn-dislike"
                  className={`rounded-full px-4 py-1.5 text-sm ${
                    rating === 'dislike' ? 'bg-sky-600/80' : 'bg-white/10 hover:bg-white/20'
                  }`}
                  onClick={() => void setRatingNow('dislike')}
                >
                  Дизлайк {rating === 'dislike' ? '✓' : ''}
                </button>
                <button
                  type="button"
                  data-focus
                  data-testid="btn-fav"
                  className={`rounded-full px-4 py-1.5 text-sm ${
                    faved ? 'bg-amber-500/30' : 'bg-white/10 hover:bg-white/20'
                  }`}
                  onClick={toggleFavorite}
                >
                  {faved ? 'В избранном ✓' : 'В избранное'}
                </button>
              </div>
            </div>

            {!data.demo && formatGroups.length > 0 && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  data-focus
                  data-testid="open-quality"
                  className="rounded-xl bg-[#181818] px-4 py-2.5 text-sm hover:bg-[#222]"
                  onClick={() => setQOpen((v) => !v)}
                >
                  Формат: {settings.maxHeight ? `${settings.maxHeight}<` : 'Авто'} ·{' '}
                  {settings.codec.toUpperCase()}
                </button>

                {qOpen && (
                  <div
                    className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-white/10 bg-[#181818] p-3 shadow-2xl"
                    data-testid="quality-dialog"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs text-white/50">Качество и кодек</span>
                      <button
                        type="button"
                        data-focus
                        className="rounded bg-white/10 px-2 text-xs"
                        onClick={() => setQOpen(false)}
                      >
                        ✕
                      </button>
                    </div>

                    <button
                      type="button"
                      data-focus
                      data-testid="quality-auto"
                      className={`mb-1 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${
                        settings.maxHeight === 0 ? 'bg-sky-600/70' : 'bg-white/5 hover:bg-white/10'
                      }`}
                      onClick={() => setSegment(settings.codec, 0)}
                    >
                      <span>Авто</span>
                      {settings.maxHeight === 0 ? <span>✓</span> : null}
                    </button>

                    {formatGroups.map((g) => {
                      const active =
                        selectedHeight === g.height && g.formats.some((f) => f.codecs === settings.codec);
                      return (
                        <div
                          key={g.label}
                          className={`mb-1 rounded-lg p-2 ${
                            active ? 'bg-sky-600/20' : 'bg-white/5'
                          }`}
                        >
                          <div className="flex items-center justify-between px-1 text-sm">
                            <span>
                              {g.label}
                              {g.formats.some((f) => f.fps && f.fps > 30) ? (
                                <span className="ml-1 text-xs text-white/40">• 60fps</span>
                              ) : null}
                              {g.formats.some((f) => f.colorInfo?.isHdr) ? (
                                <span className="ml-1 rounded bg-yellow-500/20 px-1 text-xs text-yellow-200">
                                  HDR
                                </span>
                              ) : null}
                            </span>
                            {active ? <span className="text-sky-300">✓</span> : null}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {g.formats.map((f) => (
                              <button
                                key={`${g.label}-${f.codecs}`}
                                type="button"
                                data-focus
                                data-testid={`quality-${g.label}-${f.codecs}`}
                                className={`rounded px-2 py-0.5 text-xs ${
                                  active && settings.codec === f.codecs
                                    ? 'bg-sky-600/80'
                                    : 'bg-white/10 hover:bg-white/20'
                                }`}
                                onClick={() => setSegment(f.codecs as VideoCodec, g.height && g.height > 0 ? g.height : 0)}
                              >
                                {CODEC_NAME[f.codecs as VideoCodec] ?? f.codecs}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    <span className="mt-1 block text-xs text-white/40">
                      Доступно потоков: {playableVideoCount}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* рекомендации / далее */}
          <div className="mt-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold" data-testid="recs-title">
              Смотреть далее
              {related?.upNext ? (() => {
                const up = related.upNext;
                return (
                <button
                  type="button"
                  data-focus
                  data-testid="upnext"
                  className="max-w-xl truncate rounded-full bg-white/10 px-3 py-1 text-xs font-normal text-white/80 hover:bg-white/20"
                  onClick={() => navigate({ name: 'watch', id: up.id })}
                >
                  ▶ {up.title}
                </button>
                );
              })() : null}
            </h2>
            {related?.error ? (
              <p className="text-sm text-white/40">Рекомендации сейчас недоступны ({related.error})</p>
            ) : null}
            {related && related.items.length > 0 ? (
              <>
                <FeedGrid items={related.items} />
                {related.continuation ? (
                  <button
                    type="button"
                    data-focus
                    data-testid="recs-more"
                    className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20"
                    onClick={loadMoreRecs}
                  >
                    Показать ещё
                  </button>
                ) : null}
              </>
            ) : related && !related.error ? (
              <Loading />
            ) : null}
          </div>

          {/* комментарии */}
          <CommentsSection videoId={data.id} />

          {data.isLive ? (
            <div className="mt-6">
              <LiveChatPanel videoId={data.id} />
            </div>
          ) : null}

          <div className="mt-6">
            <button
              type="button"
              data-focus
              className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20"
              onClick={() => navigate({ name: 'home' })}
            >
              ← На главную
            </button>
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-white/40">Загрузка видео…</p>
      )}
    </div>
  );
}