import { useState } from "react";
import type { OfficeToolInfo, ToolsetInfo } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { Pill, btnPrimary, card } from "./ui";

const EXAMPLES: Record<string, unknown> = {
  office_word_replace_selection: { text: "New text" },
  office_word_set_range: { text: "Whole document text", which: "whole" },
  office_word_insert_text: { text: "Hello", location: "End" },
  office_word_insert_table: { values: [["A", "B"], ["1", "2"]] },
  office_excel_get_range: { address: "A1:C10" },
  office_excel_set_range_values: { address: "A1:B2", values: [[1, 2], [3, 4]] },
  office_excel_set_formula: { address: "A1", formula: "=SUM(B1:B9)" },
  office_ppt_add_slide: {},
  office_ppt_insert_text_box: { text: "Hello", left: 50, top: 50, width: 300, height: 60 },
};

interface Props {
  host: string;
  office: OfficeToolInfo[];
  hermes: ToolsetInfo[];
  results: Record<string, { ok: boolean; result: unknown }>;
  onRunOffice: (tool: string, args: object) => void;
  onRunToolset: (toolset: string, text: string) => void;
  disabled: boolean;
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{children}</h3>
);

export default function ToolsPanel({ host, office, hermes, results, onRunOffice, onRunToolset, disabled }: Props) {
  const { t: tr } = useI18n();
  const [args, setArgs] = useState<Record<string, string>>({});
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const mine = office.filter((t) => t.host === host || host === "unknown");

  const run = (t: OfficeToolInfo) => {
    const raw = args[t.name] ?? JSON.stringify(EXAMPLES[t.name] ?? {});
    try {
      onRunOffice(t.name, JSON.parse(raw || "{}"));
      setErrs((e) => ({ ...e, [t.name]: "" }));
    } catch {
      setErrs((e) => ({ ...e, [t.name]: tr("err.invalid_json") }));
    }
  };

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-2">
      <section>
        <H>{tr("tools.office", { host })}</H>
        <div className="space-y-1.5">
          {mine.map((t) => {
            const r = results[t.name];
            const needsArgs = Object.keys(t.args).length > 0;
            return (
              <div key={t.name} className={`${card} p-2`}>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all text-[11px]">{t.name.replace(/^office_/, "")}</code>
                  <button type="button" className={btnPrimary} disabled={disabled} onClick={() => run(t)}>{tr("common.run")}</button>
                </div>
                {needsArgs && (
                  <textarea
                    className="mt-1.5 w-full rounded-md border border-gray-500/25 p-1.5 font-mono text-[11px] focus:border-indigo-500/60"
                    rows={2}
                    value={args[t.name] ?? JSON.stringify(EXAMPLES[t.name] ?? {})}
                    onChange={(e) => setArgs((a) => ({ ...a, [t.name]: e.target.value }))}
                    aria-label={tr("tools.args", { name: t.name })}
                  />
                )}
                {errs[t.name] && <p className="mt-1 text-[11px] text-red-600">{errs[t.name]}</p>}
                {r && (
                  <pre className={"mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap text-[11px] " + (r.ok ? "text-gray-500" : "text-red-600")}>
                    {r.ok ? "✓ " : "✗ "}
                    {(typeof r.result === "string" ? r.result : JSON.stringify(r.result, null, 1)).slice(0, 600)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
        {!mine.length && <p className="text-[11px] text-gray-500">{tr("tools.noOffice")}</p>}
      </section>
      <section>
        <H>{tr("tools.hermes")}</H>
        <div className="space-y-1.5">
          {hermes.map((t) => (
            <div key={t.name} className={`${card} p-2`}>
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-[12px]">{t.label || t.name}</span>
                <Pill tone={t.enabled ? "ok" : "neutral"}>{t.enabled ? tr("tools.on") : tr("tools.off")}</Pill>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  className="min-w-0 flex-1 rounded-md border border-gray-500/25 px-2 py-1 text-[12px] placeholder:text-gray-400 focus:border-indigo-500/60"
                  placeholder={tr("tools.ask", { name: t.name })}
                  value={prompts[t.name] ?? ""}
                  onChange={(e) => setPrompts((p) => ({ ...p, [t.name]: e.target.value }))}
                  onKeyDown={(e) => {
                    const v = (prompts[t.name] ?? "").trim();
                    if (e.key === "Enter" && v && !disabled && t.enabled) onRunToolset(t.name, v);
                  }}
                />
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={disabled || !t.enabled || !(prompts[t.name] ?? "").trim()}
                  onClick={() => onRunToolset(t.name, prompts[t.name].trim())}
                >
                  {tr("common.run")}
                </button>
              </div>
            </div>
          ))}
        </div>
        {!hermes.length && <p className="text-[11px] text-gray-500">{tr("tools.noHermes")}</p>}
      </section>
    </div>
  );
}
