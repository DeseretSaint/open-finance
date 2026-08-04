"use client";

import { usePathname } from "next/navigation";

/**
 * One structural rule instead of per-page patches: EVERYTHING outside the app
 * shell (landing, demo, login, register + wizard, recovery, pair, any future
 * pre-auth page) renders dark, no matter what the stored theme preference
 * says. The app shell (sidebar) keeps managing its own theme via the
 * .dark class / Settings toggle — this wrapper carries no class there.
 */
const APP_SHELL_PATHS = [
  "/dashboard",
  "/accounts",
  "/transactions",
  "/budgets",
  "/plan",
  "/reports",
  "/agents",
  "/settings",
];

export function PreAuthDark({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const preAuth = !APP_SHELL_PATHS.some((p) => pathname.startsWith(p));
  // Neutral on first SSR paint (pathname unknown) — the pre-hydration script
  // already paints dark for the default; this wrapper only needs to hold the
  // line for light-preference users on pre-auth pages.
  return <div className={preAuth ? "forced-dark min-h-screen" : undefined}>{children}</div>;
}
