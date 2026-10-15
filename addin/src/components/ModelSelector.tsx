import { useEffect, useRef, useState } from "react";
import type { ModelOption } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { IconCheck, IconChevron } from "./ui";

interface Props {
  models: ModelOption[];
  current: { model: string | null; provider: string | null } | null;
  selected: { model: string | null; provider: string | null } | null;
  onSelect: (m: ModelOption | null) => void;
  /** Open the menu upward (used when docked at the bottom). */
  up?: boolean;
}

const key = (m: { id: string; provider: string | null }) => `${m.provider ?? ""}\u0000${m.id}`;

/**
 * Empty selection = auto routing in the bridge (one model, Gemini Flash by default, for chat and inline edits).
 * Rendered as a micro-pill + popover.
 */
export default function ModelSelector({ models, selected, onSelect, up }: Props) {
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

  const active = selected?.model ? models.find((m) => m.id === selected.model && m.provider === selected.provider) : null;
  const short = (m: ModelOption) => (m.role === "core" ? t("model.coreShort") : m.role === "fast" ? t("model.fastShort") : m.label);
  const full = (m: ModelOption) => (m.role === "core" ? t("model.core") : m.role === "fast" ? t("model.fast") : m.label);
  const desc = (m: ModelOption) => (m.role === "core" ? t("model.coreDesc") : m.role === "fast" ? t("model.fastDesc") : "");
  const label = active ? short(active) : t("model.default");
  const isActive = (m: ModelOption) => (active ? key(active) === key(m) : false);
  const recommended = models.filter((m) => m.role);
  const others = models.filter((m) => !m.role);
  const pick = (m: ModelOption | null) => {
    onSelect(m);
    setOpen(false);
  };
  const item = (checked: boolean, text: string, onClick: () => void, k: string, sub?: string) => (
    <button
      key={k}
      type="button"
      role="option"
      aria-selected={checked}
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] hover:bg-gray-500/15"
    >
      <span className="w-3 shrink-0">{checked && <IconCheck className="h-3 w-3 text-indigo-500" />}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{text}</span>
        {sub && <span className="block truncate text-[10.5px] text-gray-500">{sub}</span>}
      </span>
    </button>
  );

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-label={t("model.label")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-5 max-w-[170px] items-center gap-1 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2 text-[11px] leading-none text-indigo-700 hover:brightness-95 dark:text-indigo-300"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
        <span className="truncate">{label}</span>
        <IconChevron className="h-2.5 w-2.5 shrink-0 rotate-90 opacity-60" />
      </button>
      {open && (
        <div
          role="listbox"
          className={
            "absolute left-0 z-50 max-h-64 w-64 overflow-y-auto rounded-xl border border-gray-500/25 bg-white p-1 shadow-xl dark:bg-[#1c1f24] animate-pop " +
            (up ? "bottom-full mb-1" : "top-full mt-1")
          }
        >
          {item(!active, t("model.default"), () => pick(null), "__default", t("model.autoNote"))}
          {recommended.length > 0 && <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{t("model.section.recommended")}</div>}
          {recommended.map((m) => item(isActive(m), full(m), () => pick(m), key(m), desc(m)))}
          {others.length > 0 && <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{t("model.section.other")}</div>}
          {others.map((m) => item(isActive(m), m.label, () => pick(m), key(m)))}
        </div>
      )}
    </div>
  );
}
