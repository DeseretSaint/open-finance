"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";

/**
 * The app-wide create-action convention (P15/P17): a floating `+` button,
 * bottom-right, above the mobile tab bar. Every list page with a create
 * action uses this exact component so placement is identical across tabs.
 *
 * Structural placement (v0.3.10): the button is portal-rendered to
 * document.body and positioned from the ACTUAL measured tab-bar height —
 * never from page-level CSS. Previously the FAB lived inside each page's
 * DOM tree; an ancestor containing block (the density `zoom`, sticky
 * filter bar, or any future transform/filter) could re-anchor `position:
 * fixed` and make the Activity FAB sit higher than Accounts/Budgets.
 * Portaling to body removes every such influence by construction.
 */
export function FloatingAddButton({
  onClick,
  label,
  hidden = false,
}: {
  onClick: () => void;
  label: string;
  hidden?: boolean;
}) {
  // Distance from the bottom of the viewport the FAB should sit. Measured
  // from the live tab bar (its rendered height already includes the safe
  // area), so the FAB clears it on every device and density.
  const [bottom, setBottom] = useState<number>(96);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    function measure() {
      const bar = document.getElementById("of-tab-bar");
      // Desktop: the tab bar is hidden (md:hidden) → anchor above the page.
      const barVisible = bar !== null && bar.offsetWidth > 0;
      if (barVisible && bar) {
        setBottom(bar.getBoundingClientRect().height + 16);
      } else {
        setBottom(24);
      }
    }
    measure();
    // Tab bar height can change with safe area / density; keep in sync.
    const iv = setInterval(measure, 1500);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(iv);
      window.removeEventListener("resize", measure);
    };
  }, []);

  if (hidden || !mounted) return null;

  return createPortal(
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-lg transition-transform hover:scale-105 active:scale-95"
      style={{ bottom: `${bottom}px` }}
    >
      <Plus size={26} strokeWidth={2.5} />
    </button>,
    document.body
  );
}
