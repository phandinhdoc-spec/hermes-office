import { useEffect, useRef } from "react";

export interface QuickItem { key: string; title: string; sub?: string; badges?: string[]; checked?: boolean }

/** Pop-up above the message box for the `/` (skills) and `@` (prompt library) shortcuts. The caller owns the keyboard. */
export default function QuickMenu({
  title, items, index, empty, footer, onPick, onHover,
}: {
  title: string; items: QuickItem[]; index: number; empty: string; footer?: { label: string; onClick: () => void };
  onPick: (i: number) => void; onHover: (i: number) => void;
}) {
  const sel = useRef<HTMLButtonElement>(null);
  useEffect(() => { sel.current?.scrollIntoView({ block: "nearest" }); }, [index]);
  return (
    <div role="listbox" className="animate-pop absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-xl border border-gray-500/25 bg-white shadow-xl dark:bg-[#1c1f24]">
      <div className="border-b border-gray-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{title}</div>
      <div className="max-h-52 overflow-y-auto p-1">
        {!items.length && <p className="px-2 py-1.5 text-[12px] text-gray-500">{empty}</p>}
        {items.map((it, i) => (
          <button
            key={it.key}
            ref={i === index ? sel : undefined}
            type="button"
            role="option"
            aria-selected={i === index}
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => i !== index && onHover(i)}
            onClick={() => onPick(i)}
            className={"block w-full rounded-md px-2 py-1 text-left " + (i === index ? "bg-indigo-500/15" : "hover:bg-gray-500/10")}
          >
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{it.checked && <span className="mr-1 text-emerald-500">✓</span>}{it.title}</span>
              {it.badges?.map((b) => <span key={b} className="shrink-0 rounded-full bg-gray-500/15 px-1.5 text-[9.5px] text-gray-600 dark:text-gray-300">{b}</span>)}
            </span>
            {it.sub && <span className="block truncate text-[10.5px] text-gray-500">{it.sub}</span>}
          </button>
        ))}
      </div>
      {footer && (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={footer.onClick} className="block w-full border-t border-gray-500/15 px-2 py-1.5 text-left text-[12px] font-medium text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-300">
          {footer.label}
        </button>
      )}
    </div>
  );
}
