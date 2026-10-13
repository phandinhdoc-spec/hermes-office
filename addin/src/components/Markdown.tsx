import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";

/** Strips Hermes' machine blocks (tool calls, memory proposals) so only the human part of a reply is shown. */
export const stripMachine = (t: string) =>
  t.replace(/```office-(?:tool|memory)[\s\S]*?```/g, "").replace(/```office-(?:tool|memory)[\s\S]*$/, "").replace(/\n{3,}/g, "\n\n");
/** True while a tool/memory block is still streaming in (opened but not closed). */
export const hasPartialMachine = (t: string) => /```office-(?:tool|memory)(?![\s\S]*```)/.test(t.replace(/```office-(?:tool|memory)[\s\S]*?```/g, ""));

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[\[ref:\s*[a-z]+\s*\|[^\]]+?\]\])|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(\*[^*\s][^*\n]*\*)/gi;

function Inline({ text, onRef }: { text: string; onRef: (kind: string, target: string) => void }) {
  const { t } = useI18n();
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const tok = m[0];
    if (m[1]) out.push(<code key={i} className="rounded bg-gray-500/15 px-1 py-px font-mono text-[12px]">{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={i} className="font-semibold">{tok.slice(2, -2)}</strong>);
    else if (m[3]) {
      const r = /\[\[ref:\s*([a-z]+)\s*\|\s*([^\]]+?)\s*\]\]/i.exec(tok);
      if (r) {
        const [, kind, target] = r;
        out.push(
          <button key={i} type="button" data-tip={t("ref.jump")} onClick={() => onRef(kind, target)} className="mx-0.5 inline-flex max-w-full items-center rounded-md border border-indigo-500/40 bg-indigo-500/10 px-1 text-[11px] text-indigo-700 hover:bg-indigo-500/20 dark:text-indigo-300">
            <span className="truncate">↗ {target.replace(/^["“]|["”]$/g, "").slice(0, 40)}</span>
          </button>,
        );
      }
    } else if (m[4]) {
      const r = /\[([^\]]+)\]\((https?:[^)]+)\)/.exec(tok);
      if (r) out.push(<a key={i} href={r[2]} target="_blank" rel="noreferrer noopener" className="text-indigo-600 underline decoration-indigo-400/50 hover:decoration-indigo-600 dark:text-indigo-300">{r[1]}</a>);
    } else out.push(<em key={i}>{tok.slice(1, -1)}</em>);
    last = i + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out.map((n, k) => <Fragment key={k}>{n}</Fragment>)}</>;
}

const LIST = /^\s*([-*•]|\d+[.)])\s+(.*)$/;

/** Small, dependency-free Markdown: paragraphs, bold/italic/code, links, headings, lists, fenced code. Tolerates half-streamed input. */
export function Markdown({ text, onRef }: { text: string; onRef: (kind: string, target: string) => void }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const fence = /^```(\w*)\s*$/.exec(ln);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={blocks.length} className="overflow-x-auto rounded-lg bg-gray-500/15 px-2 py-1.5 font-mono text-[11.5px] leading-[1.5]">{body.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(ln);
    if (h) {
      blocks.push(<p key={blocks.length} className="font-semibold"><Inline text={h[2]} onRef={onRef} /></p>);
      i++;
      continue;
    }
    if (LIST.test(ln)) {
      const ordered = /^\s*\d/.test(ln);
      const items: string[] = [];
      while (i < lines.length && LIST.test(lines[i])) items.push(LIST.exec(lines[i++])![2]);
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={blocks.length} className={"space-y-0.5 pl-4 " + (ordered ? "list-decimal" : "list-disc")}>
          {items.map((it, k) => <li key={k}><Inline text={it} onRef={onRef} /></li>)}
        </Tag>,
      );
      continue;
    }
    if (/^\s*\|/.test(ln)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      blocks.push(<pre key={blocks.length} className="overflow-x-auto rounded-lg bg-gray-500/10 px-2 py-1 font-mono text-[11.5px] leading-[1.5]">{rows.join("\n")}</pre>);
      continue;
    }
    if (!ln.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i]) && !/^(#{1,4})\s/.test(lines[i]) && !LIST.test(lines[i]) && !/^\s*\|/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={blocks.length}>
        {para.map((p, k) => <Fragment key={k}>{k > 0 && <br />}<Inline text={p} onRef={onRef} /></Fragment>)}
      </p>,
    );
  }
  return <div className="space-y-1.5 break-words">{blocks}</div>;
}

/** Reveals `text` progressively so a reply that arrives in big chunks still reads like someone typing. Decided at mount: stored messages show instantly. */
export function useReveal(text: string, animate: boolean): string {
  const [n, setN] = useState(animate ? 0 : text.length);
  const target = useRef(text.length);
  target.current = text.length;
  useEffect(() => {
    if (n >= text.length) return;
    if (document.hidden) { setN(target.current); return; } // nobody is watching: skip the animation
    // setTimeout, not requestAnimationFrame: rAF is suspended whenever the taskpane is not painted, which would freeze the text.
    const id = window.setTimeout(() => setN((c) => Math.min(target.current, c + Math.max(2, Math.ceil((target.current - c) / 10)))), 24);
    return () => window.clearTimeout(id);
  }, [n, text]);
  return n >= text.length ? text : text.slice(0, n);
}

export function AssistantText({ text, animate, caret, onRef }: { text: string; animate: boolean; caret: boolean; onRef: (kind: string, target: string) => void }) {
  const animated = useRef(animate).current;
  const shown = useReveal(text, animated);
  if (!shown) {
    return <span className="inline-flex items-center gap-1 py-1">{[0, 1, 2].map((k) => <span key={k} className="h-1.5 w-1.5 animate-dot rounded-full bg-gray-500" style={{ animationDelay: `${k * 0.18}s` }} />)}</span>;
  }
  return (
    <>
      <Markdown text={shown} onRef={onRef} />
      {(caret || shown.length < text.length) && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-indigo-500 align-middle" />}
    </>
  );
}
