"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Bot,
  CalendarClock,
  Landmark,
  LayoutDashboard,
  LogOut,
  Moon,
  PieChart,
  Settings,
  Sun,
  Target,
  Wallet,
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
  { href: "/settings", label: "More", Icon: Settings },
];

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
 *   carries the primary items. Theme/logout live in Settings on mobile.
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { dark, setDark } = useTheme();

  async function logout() {
    await api.post("/api/auth/logout");
    router.push("/login");
  }

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
      </nav>
    </>
  );
}
