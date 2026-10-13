import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Tip { text: string; rect: DOMRect; preferUp: boolean }

/** One shared tooltip for every [data-tip] element: centred on the target, clamped inside the viewport, flips up/down to fit. */
export default function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();

  useEffect(() => {
    const find = (n: EventTarget | null) => (n instanceof Element ? (n.closest("[data-tip]") as HTMLElement | null) : null);
    const hide = () => { window.clearTimeout(timer.current); setTip(null); };
    const show = (e: Event) => {
      const t = find(e.target);
      if (!t) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!t.isConnected) return;
        setTip({ text: t.getAttribute("data-tip") || "", rect: t.getBoundingClientRect(), preferUp: !t.hasAttribute("data-tip-down") });
      }, 300);
    };
    const out = (e: Event) => { if (find(e.target)) hide(); };
    document.addEventListener("mouseover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("mouseout", out);
    document.addEventListener("focusout", out);
    document.addEventListener("mousedown", hide);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("focusout", out);
      document.removeEventListener("mousedown", hide);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.clearTimeout(timer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const n = el.current;
    if (!tip || !n) return;
    const { width: w, height: h } = n.getBoundingClientRect();
    const r = tip.rect, gap = 6, m = 4;
    const below = r.bottom + gap, above = r.top - gap - h;
    const fitsBelow = below + h <= window.innerHeight - m, fitsAbove = above >= m;
    const top = tip.preferUp ? (fitsAbove ? above : below) : fitsBelow ? below : fitsAbove ? above : Math.max(m, below);
    const left = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), Math.max(m, window.innerWidth - w - m));
    n.style.top = `${top}px`;
    n.style.left = `${left}px`;
    n.style.visibility = "visible";
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={el}
      role="tooltip"
      style={{ position: "fixed", top: 0, left: 0, visibility: "hidden", zIndex: 1000, maxWidth: Math.max(120, window.innerWidth - 12) }}
      className="pointer-events-none animate-pop rounded-md bg-[#1f2328] px-2 py-[3px] text-[11px] leading-snug text-white shadow-lg"
    >
      {tip.text}
    </div>
  );
}
