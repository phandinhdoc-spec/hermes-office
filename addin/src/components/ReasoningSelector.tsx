import { useEffect, useRef, useState } from "react";
import { useI18n, type Key } from "../lib/i18n";
import { IconCheck, IconChevron } from "./ui";

export const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

interface Props {
  /** null = Hermes default */
  level: string | null;
  onSelect: (level: string | null) => void;
}

/** Thinking-level picker (maps to `hermes chat --reasoning`). Opens upward from the composer. */
export default function ReasoningSelector({ level, onSelect }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const name = (l: string | null) => t(`reasoning.${l ?? "default"}` as Key);
  const note = (l: string | null) => t(`reasoning.${l ?? "default"}Note` as Key);
  const row = (l: string | null) => (
    <button
      key={l ?? "__default"}
      type="button"
      role="option"
      aria-selected={level === l}
      onClick={() => { onSelect(l); setOpen(false); }}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] hover:bg-gray-500/15"
    >
      <span className="w-3 shrink-0">{level === l && <IconCheck className="h-3 w-3 text-indigo-500" />}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{name(l)}</span>
        <span className="block truncate text-[10.5px] text-gray-500">{note(l)}</span>
      </span>
    </button>
  );
  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-label={t("reasoning.label")}
        data-tip={t("reasoning.label")}
        data-tip-up=""
        data-tip-left=""
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-5 max-w-[110px] items-center gap-1 rounded-full border border-gray-500/25 bg-gray-500/10 px-2 text-[11px] leading-none hover:brightness-95"
      >
        <span aria-hidden>🧠</span>
        <span className="truncate">{name(level)}</span>
        <IconChevron className="h-2.5 w-2.5 shrink-0 -rotate-90 opacity-60" />
      </button>
      {open && (
        <div role="listbox" className="animate-pop absolute bottom-full left-0 z-50 mb-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-gray-500/25 bg-white p-1 shadow-xl dark:bg-[#1c1f24]">
          {row(null)}
          {LEVELS.map((l) => row(l))}
        </div>
      )}
    </div>
  );
}
