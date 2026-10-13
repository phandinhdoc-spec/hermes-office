import { Fragment } from "react";
import { useI18n } from "../lib/i18n";

const REF_RE = /\[\[ref:\s*([a-z]+)\s*\|\s*([^\]]+?)\s*\]\]/gi;
export const stripHidden = (t: string) => t.replace(/```office-memory[\s\S]*?```/g, "").replace(/```office-memory[\s\S]*$/, "");

/** Assistant text with [[ref: host | place]] turned into buttons that jump to that place in the document. */
export default function RichText({ text, onRef }: { text: string; onRef: (kind: string, target: string) => void }) {
  const { t } = useI18n();
  const src = stripHidden(text);
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of src.matchAll(REF_RE)) {
    out.push(<Fragment key={last}>{src.slice(last, m.index)}</Fragment>);
    const [, kind, target] = m;
    out.push(
      <button key={m.index} type="button" data-tip={t("ref.jump")} onClick={() => onRef(kind, target)} className="mx-0.5 inline-flex max-w-full items-center rounded-md border border-indigo-500/40 bg-indigo-500/10 px-1 text-[11px] text-indigo-700 hover:bg-indigo-500/20 dark:text-indigo-300">
        <span className="truncate">↗ {target.replace(/^["“]|["”]$/g, "").slice(0, 40)}</span>
      </button>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(<Fragment key="end">{src.slice(last)}</Fragment>);
  return <>{out}</>;
}
