import { useState } from "react";
import { useI18n } from "../lib/i18n";
import { uid, type Note } from "../lib/workspace";
import { btnPrimary, field, IconButton, IconTrash, IconX } from "./ui";

interface Props {
  globalNotes: Note[];
  project?: { name: string; notes: Note[] };
  onGlobal: (n: Note[]) => void;
  onProject: (n: Note[]) => void;
  onClose: () => void;
}

/** View, add and delete the confirmed notes Hermes carries into every chat of a scope. */
export default function MemoryModal({ globalNotes, project, onGlobal, onProject, onClose }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const section = (key: string, title: string, notes: Note[], set: (n: Note[]) => void) => {
    const add = () => {
      const text = (draft[key] ?? "").trim();
      if (!text) return;
      set([...notes, { id: uid(), text: text.slice(0, 300) }]);
      setDraft((d) => ({ ...d, [key]: "" }));
    };
    return (
      <section key={key} className="space-y-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{title}</h3>
        {!notes.length && <p className="text-[11px] text-gray-500">{t("memory.empty")}</p>}
        {notes.map((n) => (
          <div key={n.id} className="group flex items-start gap-1 rounded-lg px-1.5 py-1 hover:bg-gray-500/10">
            <span className="min-w-0 flex-1 break-words text-[12px]">{n.text}</span>
            <IconButton tip={t("chats.delete")} danger tipLeft onClick={() => set(notes.filter((x) => x.id !== n.id))}><IconTrash /></IconButton>
          </div>
        ))}
        <div className="flex gap-1">
          <input className={field} value={draft[key] ?? ""} maxLength={300} placeholder={t("memory.add")} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />
          <button type="button" className={btnPrimary} onClick={add}>{t("tpl.add")}</button>
        </div>
      </section>
    );
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white animate-pop dark:bg-[#14161a]" role="dialog" aria-label={t("memory.title")} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex items-center gap-1 border-b border-gray-500/20 px-2 py-1.5 pr-14">
        <strong className="flex-1 truncate text-[12px]">🧠 {t("memory.title")}</strong>
        <IconButton tip={t("common.close")} onClick={onClose}><IconX /></IconButton>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {project && section("project", project.name, project.notes, onProject)}
        {section("global", t("memory.global"), globalNotes, onGlobal)}
        <p className="text-[10.5px] text-gray-500">{t("memory.hint")}</p>
      </div>
    </div>
  );
}
