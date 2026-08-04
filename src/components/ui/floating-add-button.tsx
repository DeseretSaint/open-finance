"use client";

import { Plus } from "lucide-react";

/**
 * The app-wide create-action convention (P15/P17): a floating `+` button,
 * bottom-right, above the mobile tab bar, safe-area aware. Every list page
 * with a create action uses this exact component so placement is identical
 * across tabs.
 *
 * No keyboard-lift here: the add forms are full-screen sheets that hide the
 * FAB (hidden={showAdd}), and visualViewport keyboard tracking is flaky in
 * the Android webview (a stuck "keyboard open" delta made the Activity FAB
 * float higher than the others until the app restarted).
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
  if (hidden) return null;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-lg transition-transform hover:scale-105 active:scale-95"
      style={{
        bottom: `calc(6rem + env(safe-area-inset-bottom))`,
      }}
    >
      <Plus size={26} strokeWidth={2.5} />
    </button>
  );
}
