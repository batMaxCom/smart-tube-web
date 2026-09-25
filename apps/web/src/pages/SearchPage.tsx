import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedItem } from '@stfw/shared';
import { fetchSearch } from '../api';
import { useApp } from '../store';
import { FeedGrid } from '../components/FeedGrid';
import { Empty, ErrorBanner, Loading, SentinalHolder } from '../components/FeedUI';
import { Osk } from '../components/Osk';
import { useFeed } from '../useFeed';
import { useInfiniteScroll } from '../useInfiniteScroll';
import { useInitialFocus, useTvNavigation } from '../tvnav';
import { useT } from '../i18n/useT';

interface SbSpeechResultEvent {
  resultIndex?: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
}

interface SbSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SbSpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}

type SbSpeechCtor = new () => SbSpeechRecognition;

function getSpeechRecognition(): SbSpeechCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SbSpeechCtor;
    webkitSpeechRecognition?: SbSpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function SearchPage({ initialQuery }: { initialQuery: string }) {
  const t = useT();
  const gl = useApp((s) => s.settings.gl);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(initialQuery);
  const [oskOpen, setOskOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const recRef = useRef<SbSpeechRecognition | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, []);

  const feed = useFeed<FeedItem>(
    () =>
      active.trim()
        ? fetchSearch(active.trim(), gl)
        : Promise.resolve({ items: [], continuation: undefined }),
    'search',
    [active, gl],
  );

  useEffect(() => {
    if (initialQuery) setActive(initialQuery);
  }, [initialQuery]);

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef, [feed.items]);

  const sentinel = useInfiniteScroll(feed.loadMore, feed.hasMore);

  const submit = () => setActive(query.trim());

  const startVoice = () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      showToast('Голосовой поиск не поддерживается — откройте экранную клавиатуру');
      setOskOpen(true);
      return;
    }
    const lang = gl ? `${gl}-${gl.toUpperCase()}` : 'ru-RU';
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    let lastTranscript = '';
    rec.onresult = (e) => {
      let transcript = '';
      for (let i = e.resultIndex ?? 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r && r[0]?.transcript) transcript += r[0].transcript;
      }
      if (transcript) {
        lastTranscript = transcript;
        setQuery(transcript);
      }
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      // финальный результат применяется к поиску
      if (lastTranscript.trim()) setActive(lastTranscript.trim());
    };
    rec.onerror = (ev) => {
      setListening(false);
      recRef.current = null;
      if (ev.error && ev.error !== 'aborted') showToast(`Ошибка распознавания: ${ev.error}`);
    };
    recRef.current = rec;
    // хук для e2e: доступ к активному инстансу распознавания
    (window as unknown as { __lastSpeechRec?: SbSpeechRecognition }).__lastSpeechRec = rec;
    setListening(true);
    rec.start();
  };

  const stopVoice = () => {
    try {
      recRef.current?.stop();
    } catch {
      /* уже остановлено */
    }
    recRef.current = null;
    setListening(false);
  };

  useEffect(
    () => () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const oskControls = {
    onKey: (ch: string) => setQuery((v) => (v.length < 200 ? v + ch : v)),
    onBackspace: () => setQuery((v) => v.slice(0, -1)),
    onClear: () => setQuery(''),
    onSubmit: submit,
    onClose: () => setOskOpen(false),
  };

  return (
    <div ref={containerRef} className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4">
      <form
        className="mb-2 flex max-w-xl items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          data-focus
          className="w-full rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-base outline-none placeholder:text-white/40 focus:border-white/50"
          type="search"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          data-focus
          className="rounded-full bg-white/10 px-5 py-2.5 text-sm hover:bg-white/20"
        >
          Поиск
        </button>
        <button
          type="button"
          data-focus
          data-testid="btn-voice"
          aria-label="Голосовой поиск"
          className={`rounded-full px-3 py-2.5 text-base ${
            listening ? 'bg-red-600/80 text-white' : 'bg-white/10 hover:bg-white/20'
          }`}
          onClick={listening ? stopVoice : startVoice}
        >
          🎤
        </button>
        <button
          type="button"
          data-focus
          data-testid="btn-keyboard"
          aria-label="Экранная клавиатура"
          className={`rounded-full px-3 py-2.5 text-base ${
            oskOpen ? 'bg-sky-600/70' : 'bg-white/10 hover:bg-white/20'
          }`}
          onClick={() => setOskOpen((v) => !v)}
        >
          ⌨
        </button>
      </form>

      {toast ? (
        <div className="mb-2 max-w-xl text-sm text-yellow-200" data-testid="search-toast">
          {toast}
        </div>
      ) : null}
      {listening ? (
        <div className="mb-2 max-w-xl text-sm text-white/70" data-testid="voice-hint">
          Говорите… <span className="animate-pulse">●</span>
        </div>
      ) : null}

      {oskOpen ? <Osk {...oskControls} /> : null}

      <ErrorBanner message={feed.error} />

      {feed.items.length ? <FeedGrid items={feed.items} /> : null}

      {feed.loading ? <Loading /> : null}
      {!feed.loading && !feed.error && feed.items.length === 0 && active ? (
        <Empty text="Ничего не найдено" />
      ) : null}
      <SentinalHolder ref={sentinel} />
    </div>
  );
}