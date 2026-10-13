import { useEffect, useRef, useState } from "react";
import { useI18n, type Key } from "../lib/i18n";
import type { Mode } from "../lib/workspace";
import { IconCheck, IconChevron } from "./ui";

const MODES: Mode[] = ["auto", "approve", "readonly"];
const ICON: Record<Mode, string> = { auto: "⚡", approve: "🛡", readonly: "👁" };
const TONE: Record<Mode, string> = {
  auto: "border-gray-500/25 bg-gray-500/10",
  approve: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  readonly: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

/** Auto / review-first / read-only. Opens upward from the composer. */
export default function ModeSelector({ mode, onSelect }: { mode: Mode; onSelect: (m: Mode) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-label={t("mode.label")}
        data-tip={t("mode.label")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={"inline-flex h-5 max-w-[120px] items-center gap-1 rounded-full border px-2 text-[11px] leading-none hover:brightness-95 " + TONE[mode]}
      >
        <span aria-hidden>{ICON[mode]}</span>
        <span className="truncate">{t(`mode.${mode}` as Key)}</span>
        <IconChevron className="h-2.5 w-2.5 shrink-0 -rotate-90 opacity-60" />
      </button>
      {open && (
        <div role="listbox" className="animate-pop absolute bottom-full left-0 z-50 mb-1 w-60 rounded-xl border border-gray-500/25 bg-white p-1 shadow-xl dark:bg-[#1c1f24]">
          {MODES.map((m) => (
            <button key={m} type="button" role="option" aria-selected={mode === m} onClick={() => { onSelect(m); setOpen(false); }} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] hover:bg-gray-500/15">
              <span className="w-3 shrink-0">{mode === m && <IconCheck className="h-3 w-3 text-indigo-500" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{ICON[m]} {t(`mode.${m}` as Key)}</span>
                <span className="block truncate text-[10.5px] text-gray-500">{t(`mode.${m}Note` as Key)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
