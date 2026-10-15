import { useState } from "react";
import { useI18n } from "../lib/i18n";

export type ConsentLevel = "read" | "ask" | "full";
const LEVELS: ConsentLevel[] = ["read", "ask", "full"];

/** First-run consent dialog (also reopened from the 🛡 button): where Hermes works and how much it may change. */
export function ConsentModal({ current, onSave, onClose }: { current: ConsentLevel | null; onSave: (l: ConsentLevel) => void; onClose?: () => void }) {
  const { t } = useI18n();
  const [level, setLevel] = useState<ConsentLevel>(current ?? "ask");
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label={t("consent.title")}
      onKeyDown={(e) => e.key === "Escape" && onClose?.()}>
      <div className="animate-pop w-full max-w-[320px] space-y-2.5 rounded-xl border border-gray-500/30 bg-white p-3 shadow-xl dark:bg-[#1c1f25]">
        <h2 className="text-[13px] font-semibold">{t("consent.title")}</h2>
        <p className="text-[11.5px] leading-snug text-gray-600 dark:text-gray-300">{t("consent.folder")}</p>
        <div className="space-y-1.5" role="radiogroup">
          {LEVELS.map((l) => (
            <label key={l} className={"flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-[11.5px] " + (level === l ? "border-blue-500 bg-blue-500/10" : "border-gray-500/30 hover:bg-gray-500/10")}>
              <input type="radio" name="consent" className="mt-0.5" checked={level === l} onChange={() => setLevel(l)} />
              <span>
                <b>{t(`consent.${l}`)}</b>
                <span className="block text-gray-600 dark:text-gray-300">{t(`consent.${l}.desc`)}</span>
              </span>
            </label>
          ))}
        </div>
        {level === "full" && <p className="rounded-md bg-amber-500/15 p-2 text-[11px] leading-snug text-amber-700 dark:text-amber-300">{t("consent.fullWarn")}</p>}
        <div className="flex justify-end gap-1.5">
          {onClose && <button type="button" onClick={onClose} className="h-6 rounded-md border border-gray-500/30 px-2.5 text-[11px] hover:bg-gray-500/10">{t("history.cancel")}</button>}
          <button type="button" autoFocus onClick={() => onSave(level)} className="h-6 rounded-md bg-blue-600 px-2.5 text-[11px] font-medium text-white hover:bg-blue-500">{t("consent.save")}</button>
        </div>
      </div>
    </div>
  );
}

export interface ApprovalReq { id: string; tool: string; args: unknown }

/** Level "ask": every document change waits for the user's yes/no. */
export function ApprovalModal({ req, onAnswer }: { req: ApprovalReq; onAnswer: (allow: boolean) => void }) {
  const { t } = useI18n();
  let detail = "";
  try { detail = JSON.stringify(req.args, null, 1).slice(0, 600); } catch { /* ignore */ }
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="alertdialog" aria-modal="true" aria-label={t("consent.approveTitle")}
      onKeyDown={(e) => e.key === "Escape" && onAnswer(false)}>
      <div className="animate-pop w-full max-w-[320px] space-y-2 rounded-xl border border-gray-500/30 bg-white p-3 shadow-xl dark:bg-[#1c1f25]">
        <h2 className="text-[13px] font-semibold">{t("consent.approveTitle")}</h2>
        <p className="text-[11.5px]"><code>{req.tool}</code></p>
        {detail && detail !== "{}" && <pre className="max-h-32 overflow-auto rounded-md bg-gray-500/10 p-2 text-[10.5px]">{detail}</pre>}
        <div className="flex justify-end gap-1.5">
          <button type="button" autoFocus onClick={() => onAnswer(false)} className="h-6 rounded-md border border-gray-500/30 px-2.5 text-[11px] hover:bg-gray-500/10">{t("consent.deny")}</button>
          <button type="button" onClick={() => onAnswer(true)} className="h-6 rounded-md bg-blue-600 px-2.5 text-[11px] font-medium text-white hover:bg-blue-500">{t("consent.allow")}</button>
        </div>
      </div>
    </div>
  );
}
