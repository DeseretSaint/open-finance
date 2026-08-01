"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { Sidebar, LogoMark } from "@/components/sidebar";
import { OfflineToast } from "@/components/offline-toast";
import { DeviceLockGate } from "@/components/device-lock-gate";
import { UpdateBanner } from "@/components/update-banner";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/accounts": "Accounts",
  "/transactions": "Transactions",
  "/budgets": "Budgets",
  "/plan": "Plan",
  "/reports": "Reports",
  "/agents": "Agents",
  "/settings": "Settings",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: { display_name: string; username: string | null } }>("/api/auth/me"),
  });

  useEffect(() => {
    if (!isLoading && !data) router.replace("/login");
  }, [isLoading, data, router]);

  if (isLoading || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="space-y-3">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-24 w-72 max-w-[80vw]" />
          <div className="skeleton h-24 w-72 max-w-[80vw]" />
        </div>
      </div>
    );
  }

  const titleKey = Object.keys(TITLES).find((k) => pathname.startsWith(k));
  const pageTitle = titleKey ? TITLES[titleKey] : "Open Finance";

  return (
    <DeviceLockGate>
      <div
        className="flex min-h-dvh bg-background text-text md:h-dvh md:overflow-hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
            <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-3 px-4 md:h-16 md:px-8">
              <span className="md:hidden">
                <LogoMark size={26} />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold leading-tight">{pageTitle}</h1>
                <p className="truncate text-xs text-text-muted">Welcome back, {data.user.display_name}</p>
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1200px] px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-8">
              {children}
            </div>
            <OfflineToast />
          </main>
        </div>
      </div>
      <UpdateBanner />
    </DeviceLockGate>
  );
}
