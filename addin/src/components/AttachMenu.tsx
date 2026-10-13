import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { btnPrimary, field, IconClip } from "./ui";

/** Paperclip popover: pick a file or paste a link. Uses a plain input (not the IME textarea), Enter adds the link. */
export default function AttachMenu({ disabled, onFile, onLink }: { disabled?: boolean; onFile: (f: File) => void; onLink: (url: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const addLink = () => {
    if (!/^https?:\/\//i.test(url.trim())) return;
    onLink(url.trim());
    setUrl("");
    setOpen(false);
  };
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={t("att.add")} data-tip={t("att.add")} disabled={disabled} onClick={() => setOpen((o) => !o)} className={"inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-gray-500/15 disabled:opacity-40 " + (open ? "bg-gray-500/15" : "text-gray-500")}>
        <IconClip />
      </button>
      <input ref={pick} type="file" hidden accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.tsv,.json,.html,.htm" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { onFile(f); setOpen(false); } }} />
      {open && (
        <div className="animate-pop absolute bottom-full right-0 z-50 mb-1 w-64 space-y-1.5 rounded-xl border border-gray-500/25 bg-white p-2 shadow-xl dark:bg-[#1c1f24]">
          <button type="button" className="block w-full rounded-md border border-gray-500/25 px-2 py-1 text-left text-[12px] hover:bg-gray-500/10" onClick={() => pick.current?.click()}>📎 {t("att.file")}</button>
          <div className="flex gap-1">
            <input className={field} value={url} placeholder={t("att.link")} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && addLink()} />
            <button type="button" className={btnPrimary} disabled={!/^https?:\/\//i.test(url.trim())} onClick={addLink}>{t("tpl.add")}</button>
          </div>
          <p className="text-[10px] text-gray-500">{t("att.hint")}</p>
        </div>
      )}
    </div>
  );
}
