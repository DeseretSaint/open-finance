"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { Sidebar } from "@/components/sidebar";
import { OfflineToast } from "@/components/offline-toast";
import { DeviceLockGate } from "@/components/device-lock-gate";
import { UpdateBanner } from "@/components/update-banner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: { display_name: string; username: string | null } }>("/api/auth/me"),
  });

  useEffect(() => {
    if (!isLoading && !data) router.replace("/login");
  }, [isLoading, data, router]);

  if (isLoading || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-text-muted">
        Loading…
      </div>
    );
  }

  return (
    <DeviceLockGate>
      <div
        className="flex min-h-dvh bg-background text-text md:h-dvh md:overflow-hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <Sidebar />
        <main className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:p-8">
          <header className="mb-4 md:mb-6">
            <h2 className="text-sm text-text-muted">Welcome back,</h2>
            <h1 className="text-2xl font-bold">{data.user.display_name}</h1>
          </header>
          {children}
          <OfflineToast />
        </main>
      </div>
      <UpdateBanner />
    </DeviceLockGate>
  );
}
