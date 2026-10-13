import { useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { findTokens } from "../lib/prompts";
import { uid, type Template } from "../lib/workspace";
import { btnGhost, btnPrimary, field, IconButton, IconEdit, IconPlus, IconTrash, IconX } from "./ui";

interface Props {
  templates: Template[];
  projectId: string | null;
  projectName?: string;
  /** "new" opens straight on the creation form (from the `@` menu). */
  start: "list" | "new";
  onChange: (t: Template[]) => void;
  /** Insert a prompt into the message box and close. */
  onUse: (prompt: string) => void;
  onClose: () => void;
}

/** Prompt library: a list, and a two-part form (name + content) where [square brackets] mark the slots to fill in. */
export default function PromptModal({ templates, projectId, projectName, start, onChange, onUse, onClose }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"list" | "form">(start === "new" ? "form" : "list");
  const [editing, setEditing] = useState<Template | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [onlyHere, setOnlyHere] = useState(false);
  const [err, setErr] = useState(false);
  // Uncontrolled fields: React never rewrites them while typing, so Vietnamese input methods keep their diacritics.
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const scan = () => setSlots([...new Set(findTokens(bodyRef.current?.value ?? "").map((x) => x.text))]);

  const openForm = (tp: Template | null) => {
    setEditing(tp);
    setOnlyHere(!!tp?.projectId);
    setErr(false);
    setMode("form");
    setTimeout(() => { if (nameRef.current) nameRef.current.value = tp?.name ?? ""; if (bodyRef.current) bodyRef.current.value = tp?.prompt ?? ""; scan(); nameRef.current?.focus(); }, 0);
  };
  const save = () => {
    const name = (nameRef.current?.value ?? "").trim().slice(0, 40);
    const prompt = (bodyRef.current?.value ?? "").trim();
    if (!name || !prompt) return setErr(true);
    const item: Template = { id: editing?.id ?? uid(), name, prompt, projectId: onlyHere ? projectId : null };
    onChange(editing ? templates.map((x) => (x.id === editing.id ? item : x)) : [...templates, item]);
    if (start === "new") onClose(); // came from the `@` menu: go straight back to the message box
    else setMode("list");
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white animate-pop dark:bg-[#14161a]" role="dialog" aria-label={t("pl.title")} onKeyDown={(e) => e.key === "Escape" && (mode === "form" && start !== "new" ? setMode("list") : onClose())}>
      <div className="flex items-center gap-1 border-b border-gray-500/20 px-2 py-1.5 pr-14">
        <strong className="flex-1 truncate text-[12px]">📚 {mode === "form" ? (editing ? t("pl.edit") : t("pl.create")) : t("pl.title")}</strong>
        <IconButton tip={t("common.close")} onClick={onClose}><IconX /></IconButton>
      </div>

      {mode === "list" ? (
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
          <button type="button" className={btnPrimary} onClick={() => openForm(null)}><IconPlus />{t("pl.create")}</button>
          {!templates.length && <p className="pt-1 text-[11px] text-gray-500">{t("pl.empty")}</p>}
          {templates.map((tp) => {
            const n = new Set(findTokens(tp.prompt).map((x) => x.text)).size;
            return (
              <div key={tp.id} className="rounded-lg border border-gray-500/20 px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{tp.name}{tp.projectId && <span className="ml-1 font-normal text-gray-500">· {projectName ?? "·"}</span>}{n > 0 && <span className="ml-1 rounded-full bg-indigo-500/15 px-1.5 text-[9.5px] font-normal text-indigo-700 dark:text-indigo-300">{t("pl.slotCount", { n })}</span>}</span>
                  <IconButton tip={t("pl.edit")} onClick={() => openForm(tp)} tipLeft><IconEdit /></IconButton>
                  <IconButton tip={t("chats.delete")} danger tipLeft onClick={() => onChange(templates.filter((x) => x.id !== tp.id))}><IconTrash /></IconButton>
                </div>
                <div className="line-clamp-2 break-words text-[11px] text-gray-500">{tp.prompt}</div>
                <button type="button" className={btnGhost + " mt-1"} onClick={() => onUse(tp.prompt)}>{t("pl.use")}</button>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            <label className="block space-y-0.5">
              <span className="text-[11px] text-gray-500">{t("pl.name")}</span>
              <input ref={nameRef} className={field} maxLength={40} autoFocus />
            </label>
            <label className="flex min-h-0 flex-1 flex-col space-y-0.5">
              <span className="text-[11px] text-gray-500">{t("pl.content")}</span>
              <textarea ref={bodyRef} className={field + " min-h-[140px] flex-1 leading-[1.6]"} maxLength={4000} onInput={scan} />
            </label>
            <div className="space-y-1 rounded-lg bg-indigo-500/10 px-2 py-1.5 text-[11px]">
              <p>{t("pl.hint")}</p>
              <p className="text-gray-500">{t("pl.autoVars")}</p>
              <div className="flex flex-wrap items-center gap-1">
                {slots.length ? (
                  <><span className="text-gray-500">{t("pl.slots")}</span>{slots.map((x) => <code key={x} className="rounded bg-indigo-500/20 px-1 text-[11px]">{x}</code>)}</>
                ) : (
                  <span className="text-gray-500">{t("pl.noSlots")}</span>
                )}
              </div>
            </div>
            {projectId && (
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <input type="checkbox" className="accent-indigo-600" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} />
                {t("tpl.projectOnly")}{projectName ? ` (${projectName})` : ""}
              </label>
            )}
            {err && <p className="text-[11px] text-red-600">{t("pl.needBoth")}</p>}
          </div>
          <div className="flex justify-end gap-1.5 border-t border-gray-500/20 p-2">
            <button type="button" className={btnGhost} onClick={() => (start === "new" ? onClose() : setMode("list"))}>{t("history.cancel")}</button>
            <button type="button" className={btnPrimary} onClick={save}>{t("pl.save")}</button>
          </div>
        </>
      )}
    </div>
  );
}
