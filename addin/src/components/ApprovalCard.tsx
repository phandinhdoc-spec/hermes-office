import { useI18n } from "../lib/i18n";
import { toolLabel } from "../lib/toolLabels";
import { btnGhost, btnPrimary } from "./ui";

const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? "";
  return s.length > 160 ? s.slice(0, 160) + "…" : s;
};

/** Lists what Hermes is about to change; nothing touches the document until Apply. */
export default function ApprovalCard({ calls, onApply, onReject }: { calls: { tool: string; args: unknown }[]; onApply: () => void; onReject: () => void }) {
  const { t, lang } = useI18n();
  return (
    <div role="alertdialog" aria-label={t("approval.title")} className="animate-pop mx-2 mb-1 space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2">
      <p className="text-[12px] font-medium text-amber-800 dark:text-amber-200">🛡 {t("approval.title")} ({calls.length})</p>
      <ul className="max-h-32 space-y-1 overflow-y-auto">
        {calls.map((c, i) => (
          <li key={i} className="rounded-md bg-black/5 px-1.5 py-1 dark:bg-white/5">
            <span className="text-[11.5px] font-medium">{toolLabel(c.tool, lang, "plan")}</span> <code className="text-[10px] text-gray-500">{c.tool.replace(/^office_/, "")}</code>
            <div className="break-all text-[10.5px] text-gray-600 dark:text-gray-300">{short(c.args)}</div>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-1.5">
        <button type="button" className={btnGhost} onClick={onReject}>{t("approval.reject")}</button>
        <button type="button" autoFocus className={btnPrimary} onClick={onApply}>{t("approval.apply")}</button>
      </div>
    </div>
  );
}
