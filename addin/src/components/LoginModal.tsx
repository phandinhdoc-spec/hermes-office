import { useI18n } from "../lib/i18n";
import type { AuthInfo } from "../lib/bridge";
import { StatusDot } from "./ui";

export interface AuthProgress {
  /** "login" | "hermes" | "agy" while a flow is running, else null */
  stage: string | null;
  lines: string[];
  url?: string;
  failed?: boolean;
  manual?: boolean;
}

interface Props {
  auth: AuthInfo | null;
  progress: AuthProgress;
  onLogin: () => void;
  onCancel: () => void;
  onInstall: () => void;
  onClose: () => void;
}

/** First-run gate: install Hermes if missing, then sign in with Google. Rendered over the whole taskpane. */
export default function LoginModal({ auth, progress, onLogin, onCancel, onInstall, onClose }: Props) {
  const { t } = useI18n();
  const missing = !!auth && !auth.hermes.installed;
  const logging = progress.stage === "login" || !!auth?.login_running;
  const installing = progress.stage === "hermes" || !!auth?.install_running;
  const tail = progress.lines.slice(-4);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={t("auth.title")}>
      <div className="animate-pop w-full max-w-[300px] space-y-3 rounded-xl border border-gray-500/30 bg-white p-4 shadow-xl dark:bg-[#1c1f25]">
        <div className="space-y-1 text-center">
          <h2 className="text-[14px] font-semibold">{missing ? t("auth.noHermes.title") : t("auth.title")}</h2>
          <p className="text-[12px] text-gray-500">{missing ? t("auth.noHermes.body") : t("auth.subtitle")}</p>
        </div>

        {missing ? (
          <button type="button" disabled={installing} onClick={onInstall} className="h-9 w-full rounded-lg bg-indigo-600 text-[13px] font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
            {installing ? t("auth.installing") : t("auth.install")}
          </button>
        ) : logging ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-1.5 text-[12px]"><StatusDot tone="accent" pulse /><span className="shimmer-text">{t("auth.waiting")}</span></div>
            {progress.url && (
              <a href={progress.url} target="_blank" rel="noreferrer" className="block break-words text-center text-[11px] text-indigo-600 underline">{t("auth.openLink")}</a>
            )}
            <button type="button" onClick={onCancel} className="h-7 w-full rounded-lg border border-gray-500/30 text-[12px] hover:bg-gray-500/10">{t("auth.cancel")}</button>
          </div>
        ) : (
          <button type="button" onClick={onLogin} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-[13px] font-medium text-white hover:bg-indigo-500">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-indigo-600">G</span>
            {t("auth.button")}
          </button>
        )}

        {installing && tail.length > 0 && (
          <pre className="max-h-20 overflow-auto whitespace-pre-wrap break-all rounded-md bg-gray-500/10 p-1.5 text-[10px] text-gray-500">{tail.join("\n")}</pre>
        )}
        {progress.failed && !logging && !installing && (
          <p className="text-center text-[11px] text-red-600">{progress.manual ? t("auth.manual") : t("auth.failed")}</p>
        )}

        <p className="text-center text-[10.5px] text-gray-400">{t("auth.models")}</p>
        <button type="button" onClick={onClose} className="block w-full text-center text-[11px] text-gray-500 hover:underline">{t("auth.later")}</button>
      </div>
    </div>
  );
}
