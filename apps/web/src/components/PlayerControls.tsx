import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration } from '../api';

/** Через сколько панель прячется после последнего действия, если видео играет. */
const AUTO_HIDE_MS = 3500;

export interface PlayerUiState {
  playing: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  isFullscreen: boolean;
  isPip: boolean;
  rate: number;
  muted: boolean;
  volume: number;
  hasText: boolean;
  textVisible: boolean;
}
interface Props {
  state: PlayerUiState;
  pipSupported: boolean;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onStep: (delta: number) => void;
  onRate: () => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onToggleSubs: () => void;
  onToggleFullscreen: () => void;
  onTogglePip: () => void;
}

export function PlayerControls({
  state,
  pipSupported,
  onTogglePlay,
  onSeek,
  onStep,
  onRate,
  onVolume,
  onToggleMute,
  onToggleSubs,
  onToggleFullscreen,
  onTogglePip,
}: Props) {
  const [hoverPos, setHoverPos] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);
  const seekRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);

  const clearHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  /**
   * Показать панель. scheduleHide=true — перенести автоскрытие на 3.5 секунды вперёд.
   * scheduleHide=false — только показать, уже запланированное автоскрытие не отменяем
   * (иначе служебные pointer-события после касания гасили бы таймер).
   */
  const show = useCallback(
    (scheduleHide: boolean) => {
      if (scheduleHide) clearHide();
      setVisible(true);
      if (scheduleHide && state.playing) {
        hideTimer.current = window.setTimeout(() => {
          // фокус внутри панели (пульт/клавиатура) отменяет скрытие
          const active = document.activeElement as HTMLElement | null;
          if (active && overlayRef.current?.contains(active)) return;
          setVisible(false);
        }, AUTO_HIDE_MS);
      }
    },
    [clearHide, state.playing],
  );

  // Пауза — панель всегда на месте; старт воспроизведения — показываем и гасим по таймеру.
  useEffect(() => {
    if (!state.playing) {
      clearHide();
      setVisible(true);
      return;
    }
    show(true);
    return clearHide;
  }, [state.playing, show, clearHide]);

  useEffect(() => clearHide, [clearHide]);

  // На ТВ и телефонах нет hover: любая клавиша пульта или касание возвращают панель.
  useEffect(() => {
    const onKey = () => show(true);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  // Мышь: панель остаётся, пока курсор над видео. Тач/пульт: показ по касанию с автоскрытием.
  const onPointerEnter = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') show(false);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') show(false);
  };
  const onPointerDown = () => show(true);
  const onFocusCapture = () => show(false);

  const duration = state.duration || 0;
  const pct = duration ? (state.currentTime / duration) * 100 : 0;
  const bufferedPct = duration ? (state.bufferedEnd / duration) * 100 : 0;
  const hoverSec = hoverPos !== null ? (hoverPos / 100) * duration : null;

  const onSeekHover = (clientX: number) => {
    const el = seekRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setHoverPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  const fmt = (t: number) => formatDuration(Math.max(0, Math.floor(t)));

  return (
    <div
      ref={overlayRef}
      className="player-controls group absolute inset-0 flex flex-col justify-end"
      data-testid="player-overlay"
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onFocusCapture={onFocusCapture}
    >
      {/* затемнение при активности */}
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20 transition ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* большой центр: play/pause */}
      <button
        type="button"
        data-focus
        data-testid="btn-play"
        aria-label={state.playing ? 'Пауза' : 'Смотреть'}
        className={`absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-3xl text-white backdrop-blur-sm transition hover:bg-black/70 ${
          state.playing && !visible ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={onTogglePlay}
      >
        {state.playing ? '❚❚' : '▶'}
      </button>

      {/* нижняя панель */}
      <div
        className={`safe-bottom relative z-10 px-4 pb-3 transition ${
          visible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        data-testid="player-bottom"
      >
        {/* preview-таймлайн: показываем время в точке курсора */}
        <div className="pointer-events-none absolute -top-6 left-4 z-10 hidden sm:block">
          {hoverSec !== null ? (
            <div className="rounded bg-black/70 px-2 py-0.5 text-xs tabular-nums text-white">
              {fmt(hoverSec)} {pct > 0 ? `· +${fmt(Math.max(0, hoverSec - state.currentTime))}` : ''}
            </div>
          ) : null}
        </div>

        <div className="mb-2 h-5 cursor-pointer touch-manipulation">
          <input
            ref={seekRef}
            type="range"
            data-focus
            data-testid="seekbar"
            min={0}
            max={duration || 100}
            step={0.1}
            value={Math.min(state.currentTime, duration || 0)}
            onMouseMove={(e) => onSeekHover(e.clientX)}
            onMouseLeave={() => setHoverPos(null)}
            onPointerDown={(e) => onSeekHover(e.clientX)}
            onChange={(e) => onSeek(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${pct}%, rgba(255,255,255,0.25) ${pct}%, rgba(255,255,255,0.25) ${bufferedPct}%, rgba(255,255,255,0.12) ${bufferedPct}%)`,
            }}
            className="h-[18px] w-full cursor-pointer appearance-none rounded-full bg-white/12"
            aria-label="Перемотка"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-white select-none">
          <button
            type="button"
            data-focus
            data-testid="btn-back10"
            className="rounded-full bg-black/40 px-3 py-1.5 text-sm hover:bg-black/60"
            onClick={() => onStep(-10)}
          >
            « 10
          </button>
          <button
            type="button"
            data-focus
            data-testid="btn-fwd10"
            className="rounded-full bg-black/40 px-3 py-1.5 text-sm hover:bg-black/60"
            onClick={() => onStep(10)}
          >
            10 »
          </button>
          <span className="px-1 text-xs tabular-nums" data-testid="player-current">
            {fmt(state.currentTime)} / {fmt(duration)}
          </span>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              data-focus
              data-testid="btn-rate"
              className="rounded-full bg-black/40 px-3 py-1.5 text-sm tabular-nums hover:bg-black/60"
              onClick={onRate}
            >
              {state.rate}×
            </button>

            <div className="flex items-center gap-1">
              <button
                type="button"
                data-focus
                data-testid="btn-mute"
                className="rounded-full bg-black/40 px-2 py-1.5 text-sm hover:bg-black/60"
                onClick={onToggleMute}
              >
                {state.muted || state.volume === 0 ? '🔇' : state.volume < 0.5 ? '🔉' : '🔊'}
              </button>
              <input
                type="range"
                data-focus
                data-testid="vol-range"
                min={0}
                max={1}
                step={0.05}
                value={state.muted ? 0 : state.volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                aria-label="Громкость"
                className="hidden h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/30 sm:block"
              />
            </div>

            {state.hasText ? (
              <button
                type="button"
                data-focus
                data-testid="btn-subs"
                className={`rounded-full px-3 py-1.5 text-sm hover:bg-black/60 ${
                  state.textVisible ? 'bg-sky-600/70' : 'bg-black/40'
                }`}
                onClick={onToggleSubs}
                aria-pressed={state.textVisible}
              >
                Субтитры
              </button>
            ) : null}

            <button
              type="button"
              data-focus
              data-testid="btn-fullscreen"
              className="rounded-full bg-black/40 px-3 py-1.5 text-sm hover:bg-black/60"
              onClick={onToggleFullscreen}
            >
              {state.isFullscreen ? '⤓' : '⛶'}
            </button>

            {pipSupported ? (
              <button
                type="button"
                data-focus
                data-testid="btn-pip"
                className="rounded-full bg-black/40 px-3 py-1.5 text-sm hover:bg-black/60"
                onClick={onTogglePip}
                aria-pressed={state.isPip}
                title="Картинка в картинке"
              >
                {state.isPip ? '⧉' : '⤢'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}