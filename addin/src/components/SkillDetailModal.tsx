import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { SkillDetail } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { IconButton, IconChevron, IconChevronLeft, IconCopy, IconX } from "./ui";

interface Props {
  name: string;
  detail: SkillDetail | null | undefined; // undefined = loading, null = not found
  active: boolean;
  onToggle: (on: boolean) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

type TabId = "purpose" | "explanation" | "usage" | "source";

const inline = (s: string): ReactNode[] =>
  s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
      <code key={i} className="rounded bg-gray-500/15 px-1 text-[11px]">{p.slice(1, -1)}</code>
    ) : p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );

/** Minimal markdown view: headings, lists, fenced code, paragraphs; no HTML is ever injected. */
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith("```"); i++) code.push(lines[i]);
      out.push(<pre key={i} className="overflow-x-auto whitespace-pre rounded-md bg-gray-500/10 p-2 text-[11px]">{code.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(<h4 key={i} className={"font-semibold " + (h[1].length <= 2 ? "pt-1 text-[13px]" : "text-[12px]")}>{inline(h[2])}</h4>);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const num = /^\s*(\d+\.)\s+/.exec(line)?.[1];
      out.push(
        <div key={i} className="flex gap-1.5 pl-1" style={{ marginLeft: Math.min(line.match(/^\s*/)![0].length, 8) * 3 }}>
          <span className="shrink-0 text-gray-400">{num ?? "•"}</span>
          <span className="min-w-0 break-words">{inline(line.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</span>
        </div>,
      );
    } else if (line.trim()) {
      out.push(<p key={i} className="break-words">{inline(line)}</p>);
    }
  }
  return <div className="space-y-1.5 text-[12px] leading-relaxed">{out}</div>;
}

export default function SkillDetailModal({ name, detail, active, onToggle, onClose, onPrev, onNext, hasPrev, hasNext }: Props) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<TabId>("purpose");

  // Esc closes only this modal, not the drawer underneath.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  const tabs: { id: TabId; label: string }[] = [
    { id: "purpose", label: t("skillDetail.purpose") },
    { id: "explanation", label: t("skillDetail.explanation") },
    { id: "usage", label: t("skillDetail.usage") },
    { id: "source", label: t("skillDetail.source") },
  ];
  const desc = detail ? (lang === "vi" ? detail.description_vi : detail.description_en) : "";

  let body: ReactNode;
  if (detail === undefined) body = <p className="text-[12px] text-gray-500">{t("skillDetail.loading")}</p>;
  else if (detail === null) body = <p className="text-[12px] text-red-600">{t("skillDetail.notFound")}</p>;
  else if (tab === "purpose") {
    body = (
      <div className="space-y-2">
        {desc && <p className="text-[13px] font-medium">{desc}</p>}
        {lang === "vi" && !detail.translated && <p className="text-[11px] text-amber-600">{t("skillDetail.notTranslated")}</p>}
        {detail.purpose && detail.purpose !== detail.description_en && <Markdown text={detail.purpose} />}
        {!!detail.tags.length && (
          <div className="flex flex-wrap gap-1">
            {detail.tags.map((x) => <span key={x} className="rounded-full bg-gray-500/10 px-1.5 text-[10px] text-gray-500">{x}</span>)}
          </div>
        )}
      </div>
    );
  } else if (tab === "explanation") {
    body = detail.explanation ? <Markdown text={detail.explanation} /> : <p className="text-[12px] text-gray-500">{t("skillDetail.noExplanation")}</p>;
  } else if (tab === "usage") {
    body = (
      <div className="space-y-3">
        <Markdown text={t("skillDetail.usageGeneric", { name })} />
        {detail.usage && (
          <div className="space-y-1 border-t border-gray-500/20 pt-2">
            <h4 className="text-[12px] font-semibold">{t("skillDetail.usageHeading")}</h4>
            <Markdown text={detail.usage} />
          </div>
        )}
      </div>
    );
  } else {
    body = <pre className="whitespace-pre-wrap break-words rounded-md bg-gray-500/10 p-2 text-[11px] leading-relaxed">{detail.content}</pre>;
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white animate-pop dark:bg-[#14161a]" role="dialog" aria-modal="true" aria-label={name}>
      <div className="flex items-start gap-1.5 border-b border-gray-500/20 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-[13px]">{name}</strong>
          {detail?.category && <span className="rounded-full bg-gray-500/10 px-1.5 text-[10px] text-gray-500">{detail.category}</span>}
        </div>
        <button
          type="button"
          onClick={() => onToggle(!active)}
          aria-pressed={active}
          className={"h-6 shrink-0 rounded-md px-2 text-[11px] font-medium " + (active ? "bg-indigo-600 text-white hover:bg-indigo-500" : "border border-gray-500/30 text-gray-600 hover:bg-gray-500/10 dark:text-gray-300")}
        >
          {active ? "✓ " + t("skillDetail.active") : t("skillDetail.activate")}
        </button>
        {detail && <IconButton tip={t("skillDetail.copy")} onClick={() => void navigator.clipboard?.writeText(detail.content)}><IconCopy /></IconButton>}
        <div className="flex items-center border-l border-gray-500/20 pl-1 ml-0.5 gap-0.5">
          <IconButton tip={t("skillDetail.prev")} onClick={onPrev} disabled={!hasPrev}><IconChevronLeft /></IconButton>
          <IconButton tip={t("skillDetail.next")} onClick={onNext} disabled={!hasNext}><IconChevron /></IconButton>
        </div>
        <IconButton tip={t("common.closeEsc")} onClick={onClose}><IconX /></IconButton>
      </div>
      <div className="flex gap-0.5 border-b border-gray-500/20 px-2" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={"border-b-2 px-2 py-1 text-[11px] " + (tab === x.id ? "border-indigo-600 font-medium text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500 hover:text-gray-700")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">{body}</div>
    </div>
  );
}
