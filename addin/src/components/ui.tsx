import { useI18n } from "../lib/i18n";
import type { ReactNode } from "react";

type IconProps = { className?: string };
const svg = (d: ReactNode) =>
  function Icon({ className = "h-3.5 w-3.5" }: IconProps) {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        {d}
      </svg>
    );
  };

export const IconSend = svg(<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />);
export const IconStop = ({ className = "h-3.5 w-3.5" }: IconProps) => (
  <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>
);
export const IconSkills = svg(<path d="M8 1.8 9.6 6l4.4.4-3.3 3 1 4.3L8 11.4 4.3 13.7l1-4.3-3.3-3L6.4 6 8 1.8Z" />);
export const IconEdit = svg(<><path d="M10.5 2.5 13.5 5.5 5.5 13.5H2.5v-3l8-8Z" /><path d="m9 4 3 3" /></>);
export const IconTools = svg(<path d="M9.5 3.2a3 3 0 0 0 3.3 3.9L7 12.9a1.6 1.6 0 0 1-2.3-2.3L10.5 4.8M9.5 3.2l1.7 1.7" />);
export const IconTrash = svg(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8h6l.5-8" />);
export const IconChevron = svg(<path d="m6 4 4 4-4 4" />);
export const IconCheck = svg(<path d="m3.5 8.5 3 3 6-7" />);
export const IconX = svg(<path d="m4 4 8 8M12 4l-8 8" />);
export const IconInsert = svg(<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />);
export const IconCopy = svg(<><rect x="5.5" y="5.5" width="7" height="8" rx="1.5" /><path d="M10.5 5.5V4a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h1" /></>);
export const IconSpark = svg(<path d="M8 2v3.5M8 10.5V14M2 8h3.5M10.5 8H14M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" />);
export const IconSelection = svg(<path d="M2.5 5V3.5a1 1 0 0 1 1-1H5M11 2.5h1.5a1 1 0 0 1 1 1V5M13.5 11v1.5a1 1 0 0 1-1 1H11M5 13.5H3.5a1 1 0 0 1-1-1V11" />);
export const IconRefresh = svg(<path d="M13 3.5V7H9.5M3 12.5V9h3.5M12.4 6.5A5 5 0 0 0 3.6 5.2M3.6 9.5a5 5 0 0 0 8.8 1.3" />);
export const IconSearch = svg(<><circle cx="7" cy="7" r="4" /><path d="m10 10 3.5 3.5" /></>);

/** Compact 24px icon button with a hover tooltip. */
export function IconButton({
  tip, onClick, children, active, disabled, danger, tipLeft,
}: {
  tip: string; onClick?: () => void; children: ReactNode; active?: boolean; disabled?: boolean; danger?: boolean; tipLeft?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={tip}
      data-tip={tip}
      {...(tipLeft ? { "data-tip-left": "" } : {})}
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 " +
        (active
          ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
          : danger
            ? "text-gray-500 hover:bg-red-500/10 hover:text-red-600"
            : "text-gray-500 hover:bg-gray-500/15 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100")
      }
    >
      {children}
    </button>
  );
}

/** Micro tag/pill. Pass onClick to make it a button. */
export function Pill({
  children, onClick, tone = "neutral", tip, onRemove,
}: {
  children: ReactNode; onClick?: () => void; tone?: "neutral" | "accent" | "ok" | "warn" | "bad"; tip?: string; onRemove?: () => void;
}) {
  const { t } = useI18n();
  const tones = {
    neutral: "bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20",
    accent: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25",
    ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
    warn: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
    bad: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25",
  }[tone];
  const cls = `inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-2 text-[11px] leading-none ${tones} ` + (onClick ? "hover:brightness-95 " : "");
  const body = (
    <>
      <span className="truncate">{children}</span>
      {onRemove && (
        <span role="button" aria-label={t("common.remove")} onClick={(e) => { e.stopPropagation(); onRemove(); }} className="-mr-0.5 opacity-60 hover:opacity-100">
          <IconX className="h-2.5 w-2.5" />
        </span>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} {...(tip ? { "data-tip": tip, "data-tip-left": "" } : {})}>{body}</button>
  ) : (
    <span className={cls} title={tip}>{body}</span>
  );
}

export function StatusDot({ tone, pulse }: { tone: "ok" | "warn" | "bad" | "accent"; pulse?: boolean }) {
  const c = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", accent: "bg-indigo-500" }[tone];
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${c}`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${c}`} />
    </span>
  );
}

export const card = "rounded-xl border border-gray-500/20 bg-gray-500/[0.05]";
export const field =
  "w-full rounded-lg border border-gray-500/25 bg-transparent px-2 py-1 text-[12px] placeholder:text-gray-400 focus-within:border-indigo-500/60";
export const btnPrimary =
  "inline-flex h-6 items-center gap-1 rounded-md bg-indigo-600 px-2 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40";
export const btnGhost =
  "inline-flex h-6 items-center gap-1 rounded-md border border-gray-500/25 px-2 text-[11px] hover:bg-gray-500/10 disabled:opacity-40";
