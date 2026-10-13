import { useState } from "react";
import { useI18n } from "../lib/i18n";
import { uid, type Template } from "../lib/workspace";
import { btnPrimary, field, IconButton, IconTrash, IconX } from "./ui";

interface Props {
  templates: Template[];
  projectId: string | null;
  projectName?: string;
  onChange: (t: Template[]) => void;
  onClose: () => void;
}

/** Reusable prompts. They appear as buttons above the box and in the `/` menu. */
export default function TemplatesModal({ templates, projectId, projectName, onChange, onClose }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [onlyHere, setOnlyHere] = useState(false);
  const ok = name.trim() && prompt.trim();
  const add = () => {
    if (!ok) return;
    onChange([...templates, { id: uid(), name: name.trim().slice(0, 30), prompt: prompt.trim(), projectId: onlyHere ? projectId : null }]);
    setName(""); setPrompt("");
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white animate-pop dark:bg-[#14161a]" role="dialog" aria-label={t("tpl.title")} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex items-center gap-1 border-b border-gray-500/20 px-2 py-1.5 pr-14">
        <strong className="flex-1 truncate text-[12px]">{t("tpl.title")}</strong>
        <IconButton tip={t("common.close")} onClick={onClose}><IconX /></IconButton>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {!templates.length && <p className="text-[11px] text-gray-500">{t("tpl.empty")}</p>}
        {templates.map((tp) => (
          <div key={tp.id} className="flex items-start gap-1 rounded-lg border border-gray-500/20 px-2 py-1">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium">/{tp.name}{tp.projectId && <span className="ml-1 font-normal text-gray-500">· {t("chats.projectRules").split(" ")[0]}</span>}</div>
              <div className="line-clamp-2 break-words text-[11px] text-gray-500">{tp.prompt}</div>
            </div>
            <IconButton tip={t("chats.delete")} danger tipLeft onClick={() => onChange(templates.filter((x) => x.id !== tp.id))}><IconTrash /></IconButton>
          </div>
        ))}
        <div className="space-y-1 border-t border-gray-500/20 pt-2">
          <input className={field} value={name} maxLength={30} placeholder={t("tpl.name")} onChange={(e) => setName(e.target.value)} />
          <textarea className={field + " min-h-[90px] leading-[1.6]"} value={prompt} maxLength={4000} placeholder={t("tpl.prompt")} onChange={(e) => setPrompt(e.target.value)} />
          {projectId && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <input type="checkbox" className="accent-indigo-600" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} />
              {t("tpl.projectOnly")}{projectName ? ` (${projectName})` : ""}
            </label>
          )}
          <button type="button" className={btnPrimary} disabled={!ok} onClick={add}>{t("tpl.add")}</button>
        </div>
      </div>
    </div>
  );
}
