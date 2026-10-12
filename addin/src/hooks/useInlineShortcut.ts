import { useEffect } from "react";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** F6 for inline edit, avoiding conflicting macOS & Word defaults. */
export function isInlineShortcut(e: KeyboardEvent): boolean {
  if (e.code !== "F6" && e.key !== "F6") return false;
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
}

/** True while an IME (Telex/VNI/Unikey) is composing. Safari/WKWebView fire compositionend before the Enter keydown, so isComposing alone is not enough: keyCode 229 covers it. */
export function isImeKey(e: { nativeEvent?: KeyboardEvent; keyCode?: number; isComposing?: boolean }): boolean {
  const n = e.nativeEvent ?? (e as unknown as KeyboardEvent);
  return !!(n.isComposing || e.isComposing || n.keyCode === 229 || e.keyCode === 229);
}

export const shortcutLabel = "F6";

export function useInlineShortcut(handler: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isInlineShortcut(e) || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      handler();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handler]);
}
