import { useState } from "react";
import { useI18n } from "../lib/i18n";
import { btnGhost, btnPrimary, field, IconButton, IconX } from "./ui";

interface Props {
  title: string;
  hint: string;
  /** undefined = no name field (global rules) */
  name?: string;
  rules: string;
  onSave: (name: string, rules: string) => void;
  onClose: () => void;
}

/** Edits free-text rules, optionally with a project name. Uncontrolled text fields keep Vietnamese IME input intact. */
export default function RulesModal({ title, hint, name, rules, onSave, onClose }: Props) {
  const { t } = useI18n();
  const [nm, setNm] = useState(name ?? "");
  const [text, setText] = useState(rules);
  const needName = name !== undefined;
  const ok = !needName || nm.trim().length > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white animate-pop dark:bg-[#14161a]" role="dialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex items-center gap-1 border-b border-gray-500/20 px-2 py-1.5 pr-14">
        <strong className="flex-1 truncate text-[12px]">{title}</strong>
        <IconButton tip={t("common.close")} onClick={onClose}><IconX /></IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {needName && (
          <label className="block space-y-0.5">
            <span className="text-[11px] text-gray-500">{t("rules.name")}</span>
            <input autoFocus className={field} value={nm} onChange={(e) => setNm(e.target.value)} maxLength={60} />
          </label>
        )}
        <label className="flex min-h-0 flex-1 flex-col space-y-0.5">
          <span className="text-[11px] text-gray-500">{t("rules.rules")}</span>
          <textarea
            autoFocus={!needName}
            className={field + " min-h-[160px] flex-1 leading-[1.6]"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("rules.placeholder")}
            maxLength={8000}
          />
        </label>
        <p className="text-[10.5px] text-gray-500">{hint}</p>
      </div>
      <div className="flex justify-end gap-1.5 border-t border-gray-500/20 p-2">
        <button type="button" className={btnGhost} onClick={onClose}>{t("history.cancel")}</button>
        <button type="button" className={btnPrimary} disabled={!ok} onClick={() => onSave(nm.trim(), text)}>{t("rules.save")}</button>
      </div>
    </div>
  );
}
