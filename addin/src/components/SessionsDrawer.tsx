import { useState } from "react";
import { useI18n } from "../lib/i18n";
import type { ChatMeta, Project } from "../lib/workspace";
import { IconButton, IconEdit, IconFolder, IconPlus, IconRules, IconTrash, IconX, btnGhost } from "./ui";

interface Props {
  chats: ChatMeta[];
  projects: Project[];
  activeId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: (projectId: string | null) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onNewProject: () => void;
  onEditProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onClose: () => void;
}

/** Full-pane list of chats grouped by project. Every chat has an isolated context on the bridge. */
export default function SessionsDrawer(p: Props) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // two-click delete confirmation

  const row = (c: ChatMeta) => {
    const on = c.id === p.activeId;
    return (
      <div key={c.id} className={"group flex items-center gap-1 rounded-lg px-2 py-1 " + (on ? "bg-indigo-500/10" : "hover:bg-gray-500/10")}>
        {renaming === c.id ? (
          <input
            autoFocus
            defaultValue={c.title}
            maxLength={60}
            className="min-w-0 flex-1 rounded border border-indigo-500/50 px-1 text-[12px]"
            onBlur={(e) => { p.onRename(c.id, e.target.value.trim()); setRenaming(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
          />
        ) : (
          <button type="button" disabled={p.busy && !on} title={p.busy && !on ? t("chats.busy") : undefined} onClick={() => p.onSelect(c.id)} className={"min-w-0 flex-1 truncate text-left text-[12px] disabled:opacity-50 " + (on ? "font-medium" : "")}>
            {c.title || t("chats.untitled")}
          </button>
        )}
        <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <IconButton tip={t("chats.rename")} onClick={() => setRenaming(c.id)} tipLeft><IconEdit /></IconButton>
          <IconButton
            tip={armed === c.id ? t("chats.delete") + "?" : t("chats.delete")}
            danger
            tipLeft
            onClick={() => {
              if (armed === c.id) { setArmed(null); p.onDelete(c.id); } else { setArmed(c.id); window.setTimeout(() => setArmed((a) => (a === c.id ? null : a)), 3000); }
            }}
          ><IconTrash /></IconButton>
        </span>
      </div>
    );
  };

  const loose = p.chats.filter((c) => !c.projectId || !p.projects.some((x) => x.id === c.projectId));
  const byUpdated = (a: ChatMeta, b: ChatMeta) => b.updated - a.updated;
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white animate-pop dark:bg-[#14161a]" role="dialog" aria-label={t("chats.title")} onKeyDown={(e) => e.key === "Escape" && !renaming && p.onClose()}>
      <div className="flex items-center gap-1 border-b border-gray-500/20 px-2 py-1.5 pr-14">
        <strong className="flex-1 text-[12px]">{t("chats.title")}</strong>
        <IconButton tip={t("common.close")} onClick={p.onClose}><IconX /></IconButton>
      </div>
      <div className="flex gap-1.5 px-2 pt-2">
        <button type="button" className={btnGhost} disabled={p.busy} onClick={() => p.onNew(null)}><IconPlus />{t("chats.new")}</button>
        <button type="button" className={btnGhost} onClick={p.onNewProject}><IconFolder />{t("chats.newProject")}</button>
      </div>
      <p className="px-2 pt-1.5 text-[10.5px] text-gray-500">{t("chats.hint")}</p>
      <div className="flex-1 space-y-2 overflow-y-auto p-1.5">
        {p.projects.map((pr) => (
          <section key={pr.id}>
            <div className="group flex items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <IconFolder className="h-3 w-3" />
              <span className="min-w-0 flex-1 truncate">{pr.name}</span>
              <span className="flex shrink-0 gap-0.5 normal-case opacity-60 group-hover:opacity-100">
                <IconButton tip={t("chats.newInProject")} onClick={() => p.onNew(pr.id)} tipLeft disabled={p.busy}><IconPlus /></IconButton>
                <IconButton tip={t("chats.projectRules")} onClick={() => p.onEditProject(pr.id)} tipLeft><IconRules /></IconButton>
                <IconButton tip={t("chats.deleteProject")} onClick={() => p.onDeleteProject(pr.id)} tipLeft danger><IconTrash /></IconButton>
              </span>
            </div>
            {p.chats.filter((c) => c.projectId === pr.id).sort(byUpdated).map(row)}
          </section>
        ))}
        {(loose.length > 0 || !p.projects.length) && (
          <section>
            {p.projects.length > 0 && <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t("chats.noProject")}</div>}
            {loose.sort(byUpdated).map(row)}
          </section>
        )}
      </div>
    </div>
  );
}
