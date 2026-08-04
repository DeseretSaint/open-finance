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
  // Structural dark scope for every route outside the app shell.
  return (
    <div
      className={preAuth ? "forced-dark min-h-screen" : undefined}
      style={preAuth ? { backgroundColor: "#0c0a09", color: "#fafaf9" } : undefined}
      data-preauth={preAuth ? "dark" : undefined}
    >
      {children}
    </div>
  );
}
