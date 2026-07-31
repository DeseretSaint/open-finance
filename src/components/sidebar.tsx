"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useTheme } from "@/components/providers";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "◉" },
  { href: "/accounts", label: "Accounts", icon: "▤" },
  { href: "/transactions", label: "Transactions", icon: "⇄" },
  { href: "/budgets", label: "Budgets", icon: "◧" },
  { href: "/plan", label: "Plan", icon: "◳" },
  { href: "/reports", label: "Reports", icon: "◔" },
  { href: "/agents", label: "Agents", icon: "◫" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { dark, setDark } = useTheme();

  async function logout() {
    await api.post("/api/auth/logout");
    router.push("/login");
  }

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-5 py-4">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          ₿
        </div>
        <span className="font-semibold text-text">Open Finance</span>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                active ? "bg-accent/10 font-medium text-accent" : "text-text-muted hover:bg-surface-muted hover:text-text"
              }`}
            >
              <span className="w-4 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-border px-3 py-3">
        <button
          onClick={() => setDark(!dark)}
          className="w-full rounded-md px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-muted hover:text-text"
        >
          {dark ? "☀ Light mode" : "☾ Dark mode"}
        </button>
        <button
          onClick={logout}
          className="w-full rounded-md px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-muted hover:text-text"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
