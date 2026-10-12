import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { isImeKey, shortcutLabel } from "../hooks/useInlineShortcut";
import { IconButton, IconCheck, IconSend, IconStop, IconX, btnGhost, btnPrimary, card } from "./ui";

export interface InlineState {
  open: boolean;
  scope: "selection" | "paragraph";
  target: string;
  output: string;
  busy: boolean;
  error: string | null;
}

interface Props {
  state: InlineState;
  onSubmit: (instruction: string, autoApply: boolean) => void;
  onAccept: () => void;
  onCancel: () => void;
  onClose: () => void;
}

/** Cursor/Copilot-style inline prompt for the exact selection (or current line/cell). */
export default function InlineEdit({ state, onSubmit, onAccept, onCancel, onClose }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (state.open) setTimeout(() => ref.current?.focus(), 0);
  }, [state.open]);
  if (!state.open) return null;
  const hasOutput = !!state.output && !state.busy;
  return (
    <div
      className="absolute inset-0 z-30 flex items-start bg-black/35 p-2 backdrop-blur-[1px]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          state.busy ? onCancel() : onClose();
        }
      }}
    >
      <div className="w-full animate-pop space-y-2 rounded-xl border border-gray-500/25 bg-white p-2.5 shadow-2xl dark:bg-[#1c1f24]" role="dialog" aria-label={t("inline.dialog")}>
        <div className="flex items-center gap-2">
          <strong className="flex-1 text-[12px]">{state.scope === "paragraph" ? t("inline.editLine") : t("inline.editSel")}</strong>
          {state.busy && (
            <span className="flex items-center gap-1.5 text-[11px]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
              <span className="shimmer-text">{t("status.applying")}</span>
            </span>
          )}
          <kbd className="rounded border border-gray-500/25 px-1 text-[10px] text-gray-500">{shortcutLabel}</kbd>
          <IconButton tip={t("common.closeEsc")} onClick={onClose}><IconX /></IconButton>
        </div>
        <pre className={`${card} max-h-20 overflow-auto whitespace-pre-wrap p-2 text-[11px] text-gray-500`}>
          {state.target || t("inline.empty")}
        </pre>
        <div className="flex items-end gap-1 rounded-lg border border-gray-500/25 p-1.5 focus-within:border-indigo-500/60">
          <textarea
            ref={ref}
            className="max-h-24 min-h-[34px] flex-1 text-[12px] placeholder:text-gray-400"
            rows={2}
            value={text}
            disabled={state.busy}
            placeholder={t("inline.placeholder")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isImeKey(e) && text.trim()) {
                e.preventDefault();
                onSubmit(text.trim(), e.metaKey || e.ctrlKey);
              }
            }}
          />
          {state.busy ? (
            <IconButton tip={t("common.stop")} onClick={onCancel} danger><IconStop /></IconButton>
          ) : (
            <button
              type="button"
              aria-label={t("inline.generate")}
              disabled={!text.trim()}
              onClick={() => onSubmit(text.trim(), false)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              <IconSend />
            </button>
          )}
        </div>
        {state.error && <p className="text-[11px] text-red-600">{state.error}</p>}
        {(state.output || state.busy) && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px]">
            {state.output || "…"}
          </pre>
        )}
        {hasOutput && (
          <div className="flex gap-1.5">
            <button type="button" className={btnPrimary} onClick={onAccept}><IconCheck className="h-3 w-3" />{t("inline.accept")}</button>
            <button type="button" className={btnGhost} onClick={() => onSubmit(text.trim(), false)} disabled={!text.trim()}>{t("inline.retry")}</button>
            <button type="button" className={btnGhost} onClick={onClose}>{t("inline.discard")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
