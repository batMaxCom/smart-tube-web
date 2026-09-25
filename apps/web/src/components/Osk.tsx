const ROWS: string[][] = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
];

interface Props {
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSubmit: () => void;
  onClose: () => void;
}

/** Экранная (пультовая) клавиатура для поиска — сетка букв с TV-навигацией. */
export function Osk({ onKey, onBackspace, onClear, onSubmit, onClose }: Props) {
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3" data-testid="osk">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-white/50">Экранная клавиатура</span>
        <button
          type="button"
          data-focus
          data-testid="osk-close"
          className="rounded bg-white/10 px-2 text-xs hover:bg-white/20"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        {ROWS.map((row, r) => (
          <div key={r} className="flex flex-wrap justify-center gap-1.5">
            {row.map((ch) => (
              <button
                key={ch}
                type="button"
                data-focus
                data-testid={`osk-key-${ch}`}
                className="h-11 w-8 rounded-md bg-white/10 text-sm uppercase hover:bg-white/20 sm:w-9 sm:text-base"
                onClick={() => onKey(ch)}
              >
                {ch}
              </button>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap justify-center gap-1.5">
          <button
            type="button"
            data-focus
            data-testid="osk-key-space"
            className="h-11 rounded-md bg-white/10 px-6 text-base hover:bg-white/20"
            onClick={() => onKey(' ')}
            aria-label="Пробел"
          >
            Пробел
          </button>
          <button
            type="button"
            data-focus
            data-testid="osk-key-backspace"
            className="h-11 rounded-md bg-white/10 px-4 text-base hover:bg-white/20"
            onClick={onBackspace}
            aria-label="Удалить"
          >
            ⌫
          </button>
          <button
            type="button"
            data-focus
            data-testid="osk-key-clear"
            className="h-11 rounded-md bg-white/10 px-4 text-base hover:bg-white/20"
            onClick={onClear}
          >
            Очистить
          </button>
          <button
            type="button"
            data-focus
            data-testid="osk-key-done"
            className="h-11 rounded-md bg-[#e62117] px-4 text-base font-medium text-white hover:bg-[#c51d12]"
            onClick={onSubmit}
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}