import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import shaka from 'shaka-player';

export interface ShakaVideoHandle {
  toggle(): void;
  play(): void;
  pause(): void;
  seekTo(t: number): void;
  getCurrentTime(): number;
  setRate(r: number): void;
  getRate(): number;
  setVolume(v: number): void;
  toggleMute(): boolean;
  isMuted(): boolean;
  hasTextTracks(): boolean;
  toggleSubtitles(): boolean;
  enterFullscreen(): void;
  exitFullscreen(): void;
  isFullscreen(): boolean;
  enterPip(): void;
  exitPip(): void;
  isPip(): boolean;
}

interface Props {
  manifestUrl: string;
  videoId?: string;
  autoPlay?: boolean;
  sponsorSkip?: boolean;
  onError?: (msg: string) => void;
  onReady?: (d: { duration: number }) => void;
  onTimeUpdate?: (t: { currentTime: number; duration: number; bufferedEnd: number }) => void;
  onPlayState?: (playing: boolean) => void;
  onEnded?: () => void;
  onFullscreenChange?: (fs: boolean) => void;
  onPipChange?: (pip: boolean) => void;
  onSponsorSkip?: (title: string) => void;
  onAutoPlayBlocked?: () => void;
}

interface SbSegment {
  start: number;
  end: number;
  category: string;
}

const SB_CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo'];

export const ShakaVideo = forwardRef<ShakaVideoHandle, Props>(function ShakaVideo(
  {
    manifestUrl,
    videoId,
    autoPlay = true,
    sponsorSkip = false,
    onError,
    onReady,
    onTimeUpdate,
    onPlayState,
    onEnded,
    onFullscreenChange,
    onPipChange,
    onSponsorSkip,
    onAutoPlayBlocked,
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<shaka.Player | null>(null);
  const destroyRef = useRef<Promise<void> | null>(null);
  const genRef = useRef(0);
  const mutedRef = useRef(false);
  const volumeRef = useRef(1);
  const segmentsRef = useRef<SbSegment[]>([]);
  const lastSkipRef = useRef(-1);
  const stateRef = useRef({ onTimeUpdate, onPlayState, onEnded, onFullscreenChange, onPipChange, onSponsorSkip, onAutoPlayBlocked });
  useEffect(() => {
    stateRef.current = { onTimeUpdate, onPlayState, onEnded, onFullscreenChange, onPipChange, onSponsorSkip, onAutoPlayBlocked };
  });
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'stopped'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasText, setHasText] = useState(false);

  useImperativeHandle(ref, () => ({
    toggle: () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) void v.play().catch(() => undefined);
      else v.pause();
    },
    play: () => videoRef.current?.play().catch(() => undefined),
    pause: () => videoRef.current?.pause(),
    seekTo: (t) => {
      const v = videoRef.current;
      if (v) v.currentTime = Math.max(0, Math.min(t, v.duration || t));
    },
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    setRate: (r) => {
      if (videoRef.current) videoRef.current.playbackRate = r;
    },
    getRate: () => videoRef.current?.playbackRate ?? 1,
    setVolume: (v) => {
      volumeRef.current = v;
      if (videoRef.current) {
        videoRef.current.volume = v;
        videoRef.current.muted = v === 0;
      }
    },
    toggleMute: () => {
      const v = videoRef.current;
      if (!v) return false;
      v.muted = !v.muted;
      mutedRef.current = v.muted;
      return v.muted;
    },
    isMuted: () => videoRef.current?.muted ?? mutedRef.current,
    hasTextTracks: () => playerRef.current ? (hasText || playerRef.current.getTextTracks().length > 0) : false,
    toggleSubtitles: () => {
      const p = playerRef.current;
      if (!p) return false;
      const tracks = p.getTextTracks();
      if (tracks.length === 0) return false;
      const visible = p.isTextTrackVisible();
      p.setTextTrackVisibility(!visible);
      return !visible;
    },
    enterFullscreen: () => {
      const wrap = wrapRef.current;
      if (wrap && !document.fullscreenElement) void wrap.requestFullscreen().catch(() => undefined);
    },
    exitFullscreen: () => document.exitFullscreen().catch(() => undefined),
    isFullscreen: () => !!document.fullscreenElement,
    enterPip: () => {
      const v = videoRef.current;
      if (v && document.pictureInPictureEnabled && !document.pictureInPictureElement) {
        void v.requestPictureInPicture().catch(() => undefined);
      }
    },
    exitPip: () => {
      if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    },
    isPip: () => !!document.pictureInPictureElement,
  }));

  useEffect(() => {
    let alive = true;
    const gen = ++genRef.current;

    async function boot() {
      try {
        if (destroyRef.current) await destroyRef.current; // StrictMode: ждём teardown прошлой сессии
        if (!alive || gen !== genRef.current) return;

        shaka.polyfill.installAll();
        if (!shaka.Player.isBrowserSupported()) {
          throw new Error('Браузер не поддерживает EME/MSE');
        }

        const el = videoRef.current;
        if (!el) return;
        const player = new shaka.Player(el);
        playerRef.current = player;

        player.addEventListener('error', (event: Event) => {
          const e = event as { detail?: { code?: number } };
          const code = e.detail?.code;
          let msg = `Ошибка воспроизведения (${code ?? 'unknown'})`;
          if (code === 6003 || code === 5002) msg = 'Кодек/DRM не поддерживается браузером';
          if (code === 1001) msg = 'Сеть недоступна';
          if (code === 3014) msg = 'MediaSource не смог обработать поток';
          setErrorMsg(msg);
          setState('error');
          onError?.(msg);
        });

        await player.load(manifestUrl);
        if (!alive || gen !== genRef.current) return;

        const tracks = player.getTextTracks();
        setHasText(tracks.length > 0);

        el.volume = volumeRef.current;
        setState('ready');
        onReady?.({ duration: el.duration });

        if (autoPlay) {
          el.play().then(() => onPlayState?.(true)).catch(() => {
            if (alive) stateRef.current.onAutoPlayBlocked?.();
          });
        }
      } catch (e) {
        if (!alive || gen !== genRef.current) return;
        const msg = (e as Error)?.message ?? 'Не удалось запустить воспроизведение';
        setErrorMsg(msg);
        setState('error');
        onError?.(msg);
      }
    }

    setState('loading');
    void boot();

    return () => {
      alive = false;
      const player = playerRef.current;
      if (player) {
        playerRef.current = null;
        destroyRef.current = player.destroy().catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestUrl]);

  // СпонсорБлок: категории спонсоров/интро/аутро пропускаются автоматически
  useEffect(() => {
    if (!sponsorSkip || !videoId) return;
    let cancelled = false;
    fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${SB_CATEGORIES.join(',')}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { segment: [number, number]; category: string }[]) => {
        if (cancelled) return;
        segmentsRef.current = (Array.isArray(list) ? list : []).map((s) => ({
          start: s.segment[0],
          end: s.segment[1],
          category: s.category,
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sponsorSkip, videoId]);

  // Таймапдейт: статус плеера, буфер, авто-пропуск сегментов
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onTime = () => {
      const { onTimeUpdate, onPlayState, onSponsorSkip } = stateRef.current;
      const duration = el.duration || 0;
      let bufferedEnd = 0;
      for (let i = 0; i < el.buffered.length; i++) {
        bufferedEnd = Math.max(bufferedEnd, el.buffered.end(i));
      }
      onTimeUpdate?.({ currentTime: el.currentTime, duration, bufferedEnd });

      onPlayState?.(!el.paused && !el.ended);

      const segs = segmentsRef.current;
      for (const s of segs) {
        if (el.currentTime >= s.start && el.currentTime < s.end && lastSkipRef.current !== s.start) {
          lastSkipRef.current = s.start;
          el.currentTime = s.end;
          onSponsorSkip?.(
            `Пропущен фрагмент «${s.category}» (${(s.end - s.start).toFixed(0)} с)`,
          );
        }
      }
    };
    const handleEnded = () => stateRef.current.onEnded?.();
    const onPlaying = () => stateRef.current.onPlayState?.(true);
    const onPause = () => stateRef.current.onPlayState?.(false);
    const onFs = () => stateRef.current.onFullscreenChange?.(!!document.fullscreenElement);
    const onPip = () => {
      const pip = !!document.pictureInPictureElement;
      // документная цепочка: leavepictureinpicture срабатывает после снятия элемента
      stateRef.current.onPipChange?.(pip);
    };

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', handleEnded);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('pause', onPause);
    el.addEventListener('enterpictureinpicture', onPip);
    el.addEventListener('leavepictureinpicture', onPip);
    document.addEventListener('fullscreenchange', onFs);

    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', handleEnded);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('enterpictureinpicture', onPip);
      el.removeEventListener('leavepictureinpicture', onPip);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [manifestUrl]);

  return (
    <div ref={wrapRef} className="relative aspect-video w-full overflow-hidden rounded-xl bg-black" data-testid="player">
      <video
        ref={videoRef}
        className="h-full w-full"
        playsInline
        crossOrigin="anonymous"
        data-testid="video"
      />
      {state === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 text-white/60">
          Загрузка потока…
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
          <div className="text-base text-white/80">{errorMsg}</div>
          <button
            type="button"
            data-focus
            onClick={() => setState('stopped')}
            className="rounded-full bg-white/15 px-4 py-1.5 text-sm"
          >
            Понятно
          </button>
        </div>
      )}
    </div>
  );
});