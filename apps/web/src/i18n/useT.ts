import ru from './ru.json';
import en from './en.json';
import { useApp } from '../store';

type Dict = Record<string, string>;

const DICTS: Record<string, Dict> = {
  ru: ru as Dict,
  en: en as Dict,
};

export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = (useApp.getState().settings.lang as string) || 'ru';
  const dict = DICTS[lang] ?? DICTS.ru;
  let s = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

export function useT() {
  const lang = useApp((s) => s.settings.lang);
  const dict = DICTS[lang] ?? DICTS.ru;
  return (key: string, vars?: Record<string, string | number>) => {
    let s = dict[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return s;
  };
}
