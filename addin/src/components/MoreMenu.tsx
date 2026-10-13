import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { IconButton, IconMore } from "./ui";

export interface MenuItem { label: ReactNode; onClick: () => void; disabled?: boolean; sep?: boolean }

/** Overflow menu for the toolbar; opens upward, right-aligned. */
export default function MoreMenu({ items }: { items: MenuItem[] }) {
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
    <div ref={root} className="relative">
      <IconButton tip={t("tb.more")} onClick={() => setOpen((o) => !o)} active={open}><IconMore /></IconButton>
      {open && (
        <div role="menu" className="animate-pop absolute bottom-full right-0 z-50 mb-1 w-64 rounded-xl border border-gray-500/25 bg-white p-1 shadow-xl dark:bg-[#1c1f24]">
          {items.map((it, i) =>
            it.sep ? <div key={i} className="my-1 h-px bg-gray-500/20" /> : (
              <button key={i} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }} className="block w-full rounded-md px-2 py-1 text-left text-[12px] hover:bg-gray-500/15 disabled:opacity-40">
                {it.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
