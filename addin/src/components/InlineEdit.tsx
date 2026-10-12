import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { isImeKey, shortcutLabel } from "../hooks/useInlineShortcut";
import ImeTextarea, { type ImeTextareaHandle } from "./ImeTextarea";
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
  /** Text typed in the browser compose page; applied whenever `seq` changes. */
  incoming?: { text: string; seq: number } | null;
  onCompose?: () => void;
}

/** Cursor/Copilot-style inline prompt for the exact selection (or current line/cell). */
export default function InlineEdit({ state, onSubmit, onAccept, onCancel, onClose, incoming, onCompose }: Props) {
  const { t } = useI18n();
  // Ô nhập là uncontrolled (ImeTextarea) để bộ gõ tiếng Việt không bị React ghi đè; `draft` giữ bản nháp khi đóng/mở lại.
  const [hasText, setHasText] = useState(false);
  const draft = useRef("");
  const ref = useRef<ImeTextareaHandle>(null);
  const onTextChange = (v: string) => {
    draft.current = v;
    setHasText(!!v.trim());
  };
  useEffect(() => {
    if (!incoming) return;
    if (ref.current) ref.current.append(incoming.text);
    else onTextChange(draft.current.trim() ? draft.current + "\n" + incoming.text : incoming.text);
  }, [incoming?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
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
          {onCompose && (
            <button type="button" onClick={onCompose} data-tip={t("compose.open")} className="rounded border border-gray-500/25 px-1 text-[10px] text-gray-500 hover:bg-gray-500/10">⌨ Web</button>
          )}
          <kbd className="rounded border border-gray-500/25 px-1 text-[10px] text-gray-500">{shortcutLabel}</kbd>
          <IconButton tip={t("common.closeEsc")} onClick={onClose}><IconX /></IconButton>
        </div>
        <pre className={`${card} max-h-20 overflow-auto whitespace-pre-wrap p-2 text-[11px] text-gray-500`}>
          {state.target || t("inline.empty")}
        </pre>
        <div className="flex items-end gap-1 rounded-lg border border-gray-500/25 p-1.5 focus-within:border-indigo-500/60">
          <ImeTextarea
            ref={ref}
            className="min-h-[104px] flex-1 text-[12px] leading-[1.6] placeholder:text-gray-400"
            rows={5}
            defaultValue={draft.current}
            disabled={state.busy}
            placeholder={t("inline.placeholder")}
            onTextChange={onTextChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isImeKey(e) && draft.current.trim()) {
                e.preventDefault();
                onSubmit(draft.current.trim(), e.metaKey || e.ctrlKey);
              }
            }}
          />
          {state.busy ? (
            <IconButton tip={t("common.stop")} onClick={onCancel} danger><IconStop /></IconButton>
          ) : (
            <button
              type="button"
              aria-label={t("inline.generate")}
              disabled={!hasText}
              onClick={() => onSubmit(draft.current.trim(), false)}
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
            <button type="button" className={btnGhost} onClick={() => onSubmit(draft.current.trim(), false)} disabled={!hasText}>{t("inline.retry")}</button>
            <button type="button" className={btnGhost} onClick={onClose}>{t("inline.discard")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
