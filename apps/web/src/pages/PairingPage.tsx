import { useCallback, useEffect, useRef, useState } from 'react';
import { pairingPoll, pairingSend, pairingStart, pairingStatus } from '../api';
import { useApp } from '../store';
import { useInitialFocus, useTvNavigation } from '../tvnav';
import { useT } from '../i18n/useT';

interface TvState {
  code?: string;
  verificationUrl?: string;
  paired: boolean;
  deviceName?: string;
  error?: string;
}

export function PairingPage({ target }: { target?: string }) {
  const t = useT();
  const navigate = useApp((s) => s.navigate);
  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef);

  const [tv, setTv] = useState<TvState>({ paired: false });
  const [link, setLink] = useState('');
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const startedRef = useRef(false);

  /* ---------- ТВ: создание сессии и поллинг команд ---------- */
  useEffect(() => {
    if (target) return;
    if (startedRef.current) return;
    startedRef.current = true;
    let alive = true;

    pairingStart()
      .then((r) => {
        if (!alive) return;
        if (r.ok && r.code) setTv((s) => ({ ...s, code: r.code, verificationUrl: r.verificationUrl }));
        else if (r.error) setTv((s) => ({ ...s, error: r.error }));
      })
      .catch((e: Error) => alive && setTv((s) => ({ ...s, error: e.message })));

    const timer = setInterval(() => {
      const code = (pairingStateRef.current?.code ?? '') as string;
      if (!code) return;
      pairingPoll(code)
        .then((r) => {
          if (!alive) return;
          if (!r.ok) {
            setTv((s) => ({ ...s, error: r.error ?? 'Сессия недоступна' }));
            return;
          }
          setTv((s) => ({ ...s, paired: r.paired, deviceName: r.deviceName, error: undefined }));
          const last = r.commands[r.commands.length - 1];
          if (last?.kind === 'play') navigate({ name: 'watch', id: last.videoId });
        })
        .catch(() => undefined);
    }, 2500);

    return () => {
      alive = false;
      startedRef.current = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pairingStateRef = useRef(tv);
  useEffect(() => {
    pairingStateRef.current = tv;
  }, [tv]);

  /* ---------- телефон: форма отправки ---------- */
  const submitFromPhone = useCallback(async () => {
    if (!target) return;
    setSendMsg(null);
    try {
      const r = await pairingSend({ code: target, videoId: link, deviceName: 'Телефон' });
      if (r.ok) setSendMsg(`Отправлено на ТВ (код ${target}) 🎬`);
      else setSendMsg(r.error ?? 'Не удалось отправить');
    } catch (e) {
      setSendMsg((e as Error).message ?? 'Не удалось отправить');
    }
  }, [target, link]);

  /* ---------- телефон: статус ТВ ---------- */
  useEffect(() => {
    if (!target) return;
    let alive = true;
    const timer = setInterval(() => {
      pairingStatus(target)
        .then((r) => {
          if (!alive) return;
          if (r.ok) setTv((s) => ({ ...s, paired: r.paired ?? false, deviceName: r.deviceName }));
          else setTv((s) => ({ ...s, error: r.error }));
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [target]);

  const done = () => navigate({ name: 'home' });
  const code = target ?? tv.code;
  const verifyUrl = tv.verificationUrl;

  return (
    <div ref={containerRef} className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold" data-testid="pairing-page">{t('pairing.title')}</h1>
        <button
          type="button"
          data-focus
          data-testid="pairing-done"
          className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20"
          onClick={done}
        >
          Готово
        </button>
      </div>

      {target ? (
        /* ---------- телефонная страница ---------- */
        <div className="rounded-xl bg-[#181818] p-5">
          <div className="text-sm text-white/60">
            Вы управляете ТВ. Код привязки:
          </div>
          <div className="mt-2 font-mono text-4xl font-bold tracking-[0.4em] text-sky-300" data-testid="pairing-target-code">
            {target}
          </div>
          {tv.paired ? (
            <div className="mt-2 text-sm text-white/70" data-testid="pairing-status">
              ТВ: {tv.deviceName ?? 'подключён'} ✓
            </div>
          ) : (
            <div className="mt-2 text-sm text-white/50" data-testid="pairing-status">
              Ждём, когда ТВ появится в сети…
            </div>
          )}

          <label className="mt-4 block text-sm">Что отправить на ТВ:</label>
          <input
            data-focus
            data-testid="pairing-send-input"
            className="mt-1 w-full rounded-lg border border-white/15 bg-[#0f0f0f] px-3 py-2.5 text-sm outline-none focus:border-sky-500"
            placeholder="Ссылка YouTube (watch?v=… / youtu.be/…) или videoId"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitFromPhone();
            }}
          />
          <button
            type="button"
            data-focus
            data-testid="btn-pairing-send"
            className="mt-3 rounded-full bg-[#e62117] px-5 py-2 text-sm font-medium text-white hover:bg-[#c51d12]"
            onClick={() => void submitFromPhone()}
          >
            Отправить на ТВ ▶
          </button>
          {sendMsg ? (
            <div className="mt-3 text-sm text-white/70" data-testid="pairing-send-result">{sendMsg}</div>
          ) : null}
        </div>
      ) : (
        /* ---------- страница ТВ ---------- */
        <div className="rounded-xl bg-[#181818] p-5">
          {tv.error ? (
            <div className="text-sm text-red-400" data-testid="pairing-error">{tv.error}</div>
          ) : code ? (
            <>
              <div className="text-sm text-white/60">
                Откройте на телефоне ссылку и введите код:
              </div>
              <div className="mt-2 font-mono text-5xl font-bold tracking-[0.4em] text-sky-300" data-testid="pairing-code">
                {code}
              </div>
              {verifyUrl ? (
                <div className="mt-3 text-sm text-white/60">
                  Ссылка: <span className="break-all text-sky-300" data-testid="pairing-verify">{verifyUrl}</span>
                </div>
              ) : null}
              <div className="mt-2 text-xs text-white/40">Код действует 10 минут</div>
              <div className="mt-4 text-sm" data-testid="pairing-status">
                {tv.paired ? (
                  <span className="text-sky-300">{tv.deviceName ?? 'Телефон'} подключён ✓ — отправьте видео</span>
                ) : (
                  <span className="text-white/60">Ожидание подключения телефона…</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-white/60">{t('common.loading')}</div>
          )}
        </div>
      )}

      <div className="rounded-xl bg-white/5 p-4 text-xs leading-relaxed text-white/50" data-testid="pairing-hint">
        Как это работает: ТВ показывает код. На телефоне открывается ссылка вида
        <span className="text-white/70"> …/#/pairing/КОД </span> — достаточно вставить ссылку YouTube
        или videoId, и видео начнёт играть на ТВ. Чтобы переделать (заново запросить код) — вернитесь
        в «Настройки», раздел «Смотреть на ТВ».
      </div>
    </div>
  );
}