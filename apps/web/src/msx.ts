/**
 * Запуск из Media Station X.
 *
 * MSX открывает веб-приложение через действие `link:{URL}`, поэтому в адресе
 * есть метка `msx=1`. По ней мы показываем кнопку выхода обратно в меню MSX.
 * См. https://msx.benzac.de/wiki/index.php?title=Tips_%26_Tricks
 * (External HTML5 Games/Apps).
 */

/** Приложение открыто из MSX. */
export function isMsxMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('msx') === '1';
  } catch {
    return false;
  }
}

/**
 * Вернуться в Media Station X.
 *
 * Спецификация MSX требует, чтобы внешнее HTML5-приложение само умело завершаться:
 * `window.history.go(1 - window.history.length)`. Если у приложения нет собственных
 * записей истории (открыли сразу на корне), уходим на шаг назад — за нами история MSX.
 */
export function exitToMsx(): void {
  const length = window.history.length;
  window.history.go(length > 1 ? 1 - length : -1);
}
