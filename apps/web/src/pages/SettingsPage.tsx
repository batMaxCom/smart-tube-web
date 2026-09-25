import { useRef, useState } from 'react';
import { backupGet, backupSave } from '../api';
import { COUNTRIES, useApp, type Country, type Lang, type Theme } from '../store';
import { useInitialFocus, useTvNavigation } from '../tvnav';
import { useT } from '../i18n/useT';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#181818] p-4">
      <div className="text-sm">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Seg<T extends string | number | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; title?: string; labelKey?: string }[];
  onChange: (v: T) => void;
}) {
  const t = useT();
  return (
    <>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          data-focus
          className={`rounded-lg px-3 py-1.5 text-sm ${
            value === o.value ? 'bg-sky-600/80' : 'bg-white/10 hover:bg-white/20'
          }`}
          onClick={() => onChange(o.value)}
        >
          {o.labelKey ? t(o.labelKey) : (o.title ?? '')}
        </button>
      ))}
    </>
  );
}

const THEME_OPTIONS: { value: Theme; labelKey: string }[] = [
  { value: 'dark', labelKey: 'settings.theme.dark' },
  { value: 'light', labelKey: 'settings.theme.light' },
];
const LANG_OPTIONS: { value: Lang; title: string }[] = [
  { value: 'ru', title: 'Русский' },
  { value: 'en', title: 'English' },
];
const COUNTRY_OPTIONS: { value: Country; title: string }[] = COUNTRIES.map((c) => ({
  value: c,
  title: c === 'US' ? 'США 🇺🇸' : c === 'RU' ? 'Россия 🇷🇺' : c === 'UA' ? 'Украина 🇺🇦' : c === 'BY' ? 'Беларусь 🇧🇾' : c === 'KZ' ? 'Казахстан 🇰🇿' : c === 'DE' ? 'Германия 🇩🇪' : c === 'GB' ? 'Британия 🇬🇧' : c === 'FR' ? 'Франция 🇫🇷' : c === 'PL' ? 'Польша 🇵🇱' : c === 'AU' ? 'Австралия 🇦🇺' : c,
}));

export function SettingsPage() {
  const t = useT();
  const settings = useApp((s) => s.settings);
  const history = useApp((s) => s.history);
  const setTheme = useApp((s) => s.setTheme);
  const setLang = useApp((s) => s.setLang);
  const setCountry = useApp((s) => s.setCountry);
  const setAutoplayNext = useApp((s) => s.setAutoplayNext);
  const setAudioMode = useApp((s) => s.setAudioMode);
  const navigate = useApp((s) => s.navigate);
  const applyBackup = useApp((s) => s.applyBackup);

  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  useTvNavigation(containerRef);
  useInitialFocus(containerRef);

  const doCreate = async () => {
    setBackupMsg(null);
    setCreatedCode(null);
    try {
      const r = await backupSave(undefined, { settings, history });
      setCreatedCode(r.code ?? null);
      setBackupMsg('Копия сохранена. Запишите код — с ним настройки можно восстановить на другом устройстве.');
    } catch (e) {
      setBackupMsg((e as Error).message);
    }
  };

  const doRestore = async () => {
    setBackupMsg(null);
    const code = restoreCode.trim().toUpperCase();
    if (!code) {
      setBackupMsg('Введите код резервной копии');
      return;
    }
    try {
      const doc = await backupGet(code);
      applyBackup(doc.data as Parameters<typeof applyBackup>[0]);
      setBackupMsg('Настройки и история восстановлены из копии ✅');
    } catch (e) {
      setBackupMsg((e as Error).message);
    }
  };

  return (
    <div ref={containerRef} className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-4">
      <h1 className="px-1 text-2xl font-semibold">{t('settings.title')}</h1>

      <Row label={t('settings.theme')}>
        <Seg value={settings.theme} options={THEME_OPTIONS} onChange={setTheme} />
      </Row>

      <Row label={t('settings.lang')}>
        <Seg value={settings.lang} options={LANG_OPTIONS} onChange={setLang} />
      </Row>

      <Row label={t('settings.country')}>
        <Seg value={settings.gl} options={COUNTRY_OPTIONS} onChange={setCountry} />
      </Row>

      <Row label={t('settings.autoplay')}>
        <Seg<boolean>
          value={settings.autoplayNext}
          options={[
            { value: true, title: 'Вкл (как SmartTube)' },
            { value: false, title: 'Выкл' },
          ]}
          onChange={setAutoplayNext}
        />
      </Row>

      <Row label={t('settings.audioMode')}>
        <Seg<boolean>
          value={settings.audioMode}
          options={[
            { value: true, title: 'Вкл' },
            { value: false, title: 'Выкл' },
          ]}
          onChange={setAudioMode}
        />
      </Row>

      <Row label={t('settings.pairing')}>
        <button
          type="button"
          data-focus
          data-testid="settings-pairing"
          className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20"
          onClick={() => navigate({ name: 'pairing' })}
        >
          Показать код на ТВ
        </button>
      </Row>

      <div className="rounded-xl bg-[#181818] p-4">
        <div className="mb-3 text-sm">{t('settings.backup.title')}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-focus
            data-testid="backup-create"
            className="rounded-full bg-white/10 px-4 py-1.5 text-sm hover:bg-white/20"
            onClick={() => void doCreate()}
          >
            Создать копию
          </button>
          {createdCode ? (
            <span data-testid="backup-code" className="rounded bg-black/40 px-3 py-1.5 font-mono text-lg tracking-widest text-sky-300">
              {createdCode}
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={restoreCode}
            onChange={(e) => setRestoreCode(e.target.value)}
            data-testid="backup-restore-input"
            placeholder={t('settings.backup.restorePlaceholder')}
            className="w-44 rounded-lg border border-white/10 bg-[#0f0f0f] px-3 py-1.5 text-sm uppercase tracking-widest outline-none focus:border-sky-500"
          />
          <button
            type="button"
            data-focus
            data-testid="backup-restore"
            className="rounded-full bg-sky-600 px-4 py-1.5 text-sm hover:bg-sky-500"
            onClick={() => void doRestore()}
          >
            Восстановить
          </button>
        </div>
        {backupMsg ? (
          <div className="mt-2 text-xs text-white/60" data-testid="backup-msg">
            {backupMsg}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl bg-white/5 p-4 text-xs leading-relaxed text-white/50">
        Настройки и локальная история сохраняются в IndexedDB. Формат и максимальное качество
        выбираются в плеере (если сервер выдает потоки). Вход в аккаунт — в разделе «Аккаунт».
      </div>
    </div>
  );
}