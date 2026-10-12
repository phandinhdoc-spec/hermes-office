import { useEffect } from "react";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** F6 for inline edit, avoiding conflicting macOS & Word defaults. */
export function isInlineShortcut(e: KeyboardEvent): boolean {
  if (e.code !== "F6" && e.key !== "F6") return false;
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
}

export const shortcutLabel = "F6";

export function useInlineShortcut(handler: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isInlineShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      handler();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handler]);
}
