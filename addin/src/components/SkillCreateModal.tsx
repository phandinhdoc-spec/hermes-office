import { useState } from "react";
import { useI18n } from "../lib/i18n";
import { btnGhost, btnPrimary, field, IconButton, IconX } from "./ui";

interface Props {
  busy: boolean;
  error: string | null;
  onCreate: (name: string, description: string, body: string) => void;
  onClose: () => void;
}

/** Form for writing a new ~/.hermes/skills/<name>/SKILL.md through the bridge. */
export default function SkillCreateModal({ busy, error, onCreate, onClose }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [body, setBody] = useState("");
  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(name.trim()) && desc.trim() && body.trim();
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white animate-pop dark:bg-[#14161a]" role="dialog" aria-label={t("skillNew.title")} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex items-center gap-1 border-b border-gray-500/20 px-2 py-1.5 pr-14">
        <strong className="flex-1 truncate text-[12px]">{t("skillNew.title")}</strong>
        <IconButton tip={t("common.close")} onClick={onClose}><IconX /></IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        <label className="block space-y-0.5">
          <span className="text-[11px] text-gray-500">{t("skillNew.name")}</span>
          <input autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} spellCheck={false} />
        </label>
        <label className="block space-y-0.5">
          <span className="text-[11px] text-gray-500">{t("skillNew.desc")}</span>
          <input className={field} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} />
        </label>
        <label className="flex min-h-0 flex-1 flex-col space-y-0.5">
          <span className="text-[11px] text-gray-500">{t("skillNew.body")}</span>
          <textarea className={field + " min-h-[160px] flex-1 leading-[1.6]"} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
        </label>
        {error && <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">{error}</p>}
      </div>
      <div className="flex justify-end gap-1.5 border-t border-gray-500/20 p-2">
        <button type="button" className={btnGhost} onClick={onClose}>{t("history.cancel")}</button>
        <button type="button" className={btnPrimary} disabled={!valid || busy} onClick={() => onCreate(name.trim(), desc.trim(), body.trim())}>{t("skillNew.create")}</button>
      </div>
    </div>
  );
}
