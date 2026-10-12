import { useMemo, useState } from "react";
import type { SkillDetail, SkillInfo } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import SkillDetailModal from "./SkillDetailModal";
import { IconButton, IconRefresh, IconSearch, IconX, btnGhost } from "./ui";

interface Props {
  open: boolean;
  skills: SkillInfo[];
  active: string[];
  onChange: (active: string[]) => void;
  onRefresh: () => void;
  onClose: () => void;
  /** undefined = loading, null = SKILL.md not found */
  details: Record<string, SkillDetail | null>;
  onRequestDetail: (name: string) => void;
}

/** Slide-over list of installed Hermes skills; ticked skills are preloaded (`-s`) for every request. */
export default function SkillsDrawer({ open, skills, active, onChange, onRefresh, onClose, details, onRequestDetail }: Props) {
  const { t, lang } = useI18n();
  const [detailName, setDetailName] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => skills.filter((s) => s.enabled && (s.name + " " + s.category).toLowerCase().includes(q.toLowerCase())),
    [skills, q],
  );
  if (!open) return null;
  const toggle = (name: string, on: boolean) =>
    onChange(on ? [...active, name] : active.filter((n) => n !== name));
  const openDetail = (name: string) => {
    setDetailName(name);
    if (!(name in details)) onRequestDetail(name);
  };
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col bg-white animate-pop dark:bg-[#14161a]"
      role="dialog"
      aria-label={t("skillsDrawer.title")}
      onKeyDown={(e) => e.key === "Escape" && !detailName && onClose()}
    >
      <div className="flex items-center gap-1 border-b border-gray-500/20 px-2 py-1.5">
        <strong className="flex-1 text-[12px]">
          {t("skillsDrawer.title")} <span className="font-normal text-gray-500">· {t("skillsDrawer.active", { n: active.length })}</span>
        </strong>
        <IconButton tip={t("common.refresh")} onClick={onRefresh}><IconRefresh /></IconButton>
        <IconButton tip={t("common.close")} onClick={onClose}><IconX /></IconButton>
      </div>
      <div className="flex items-center gap-2 px-2 pt-2">
        <label className="flex flex-1 items-center gap-1.5 rounded-lg border border-gray-500/25 px-2 py-1 focus-within:border-indigo-500/60">
          <IconSearch className="h-3 w-3 text-gray-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("skillsDrawer.filter")} className="w-full text-[12px]" />
        </label>
        <button type="button" className={btnGhost} onClick={() => onChange(shown.map((s) => s.name))} disabled={!shown.length}>{t("skillsDrawer.all")}</button>
        <button type="button" className={btnGhost} onClick={() => onChange([])} disabled={!active.length}>{t("skillsDrawer.none")}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {shown.map((s) => {
          const on = active.includes(s.name);
          return (
            <div key={s.name} className="flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-gray-500/10">
              <input type="checkbox" checked={on} onChange={(e) => toggle(s.name, e.target.checked)} aria-label={s.name} className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-indigo-600" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={"flex-1 truncate text-[12px] " + (on ? "font-medium" : "")}>{s.name}</span>
                  {s.category && <span className="shrink-0 rounded-full bg-gray-500/10 px-1.5 text-[10px] text-gray-500">{s.category}</span>}
                </div>
                <button
                  type="button"
                  title={t("skillsDrawer.details")}
                  onClick={() => openDetail(s.name)}
                  className="block w-full cursor-pointer truncate text-left text-[11px] text-gray-400 hover:text-blue-500"
                >
                  {(lang === "vi" ? s.description_vi : s.description_en) || s.description_en || t("skillsDrawer.noDesc")}
                </button>
              </div>
            </div>
          );
        })}
        {!shown.length && <p className="p-3 text-center text-[12px] text-gray-500">{skills.length ? t("skillsDrawer.noMatch") : t("skillsDrawer.empty")}</p>}
      </div>
      {detailName && (
        <SkillDetailModal
          name={detailName}
          detail={details[detailName]}
          active={active.includes(detailName)}
          onToggle={(on) => toggle(detailName, on)}
          onClose={() => setDetailName(null)}
        />
      )}
    </div>
  );
}
