"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Bot,
  CalendarClock,
  Landmark,
  LayoutDashboard,
  LogOut,
  Moon,
  MoreHorizontal,
  PieChart,
  Settings,
  Sun,
  Target,
  Wallet,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useTheme } from "@/components/providers";

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", Icon: Wallet },
  { href: "/transactions", label: "Transactions", Icon: ArrowLeftRight },
  { href: "/budgets", label: "Budgets", Icon: Target },
  { href: "/plan", label: "Plan", Icon: CalendarClock },
  { href: "/reports", label: "Reports", Icon: PieChart },
  { href: "/agents", label: "Agents", Icon: Bot },
  { href: "/settings", label: "Settings", Icon: Settings },
];

const TAB_BAR = [
  { href: "/dashboard", label: "Home", Icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", Icon: Wallet },
  { href: "/transactions", label: "Activity", Icon: ArrowLeftRight },
  { href: "/budgets", label: "Budgets", Icon: Target },
] as const;

/** Destinations behind the mobile "More" button — everything not on the bar. */
const MORE_ITEMS = [
  { href: "/plan", label: "Plan", Icon: CalendarClock, blurb: "Bills, debts & goals" },
  { href: "/reports", label: "Reports", Icon: PieChart, blurb: "Trends & projections" },
  { href: "/agents", label: "Agents", Icon: Bot, blurb: "Connect your AI" },
  { href: "/settings", label: "Settings", Icon: Settings, blurb: "Everything else" },
] as const;

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl"
      style={{ width: size, height: size, background: "var(--accent)", color: "var(--accent-foreground)" }}
      aria-hidden
    >
      <Landmark size={size * 0.55} strokeWidth={2.2} />
    </div>
  );
}

/**
 * Responsive navigation:
 * - Desktop (md+): fixed left sidebar with logo, nav, theme + logout.
 * - Mobile (<md): hidden sidebar; a bottom tab bar (with safe-area inset)
 *   carries the primary items, plus a "More" sheet that opens a grid with
 *   every remaining destination (Plan, Reports, Agents, Settings) so no page
 *   is phone-inaccessible. Theme/logout live in Settings on mobile.
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { dark, setDark } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the sheet on navigation.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  async function logout() {
    await api.post("/api/auth/logout");
    router.push("/login");
  }

  const moreActive = MORE_ITEMS.some((i) => pathname.startsWith(i.href));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden h-full w-60 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <LogoMark size={32} />
          <span className="truncate font-semibold text-text">Open Finance</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Primary">
          {NAV.map(({ href, label, Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-text-muted hover:bg-surface-muted hover:text-text"
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-border px-3 py-3">
          <button
            onClick={() => setDark(!dark)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
          >
            {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
          >
            <LogOut size={18} aria-hidden />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav
        id="of-tab-bar"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-border bg-surface md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        {TAB_BAR.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
                active ? "text-accent" : "text-text-muted hover:text-text"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
              {label}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          aria-current={moreActive ? "page" : undefined}
          aria-expanded={moreOpen}
          className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${
            moreActive ? "text-accent" : "text-text-muted hover:text-text"
          }`}
        >
          <MoreHorizontal size={20} strokeWidth={moreActive ? 2.2 : 1.8} aria-hidden />
          More
        </button>
      </nav>

      {/* Mobile "More" sheet — every remaining destination, one tap away. */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-surface px-5 pb-6 pt-3 shadow-[0_-8px_32px_rgb(0_0_0/0.18)]"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden />
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-text">More</p>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {MORE_ITEMS.map(({ href, label, Icon, blurb }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex flex-col gap-1 rounded-xl border p-4 transition-colors ${
                      active ? "border-accent bg-accent/5" : "border-border bg-surface hover:bg-surface-muted"
                    }`}
                  >
                    <Icon size={22} strokeWidth={1.8} className={active ? "text-accent" : "text-text-muted"} aria-hidden />
                    <span className={`text-sm font-medium ${active ? "text-accent" : "text-text"}`}>{label}</span>
                    <span className="text-xs text-text-muted">{blurb}</span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <button
                onClick={() => setDark(!dark)}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-text-muted transition-colors hover:text-text"
              >
                {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
                {dark ? "Light mode" : "Dark mode"}
              </button>
              <button
                onClick={logout}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-text-muted transition-colors hover:text-danger"
              >
                <LogOut size={18} aria-hidden />
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
