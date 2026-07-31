"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { Sidebar } from "@/components/sidebar";
import { OfflineToast } from "@/components/offline-toast";
import { DeviceLockGate } from "@/components/device-lock-gate";

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
      <div className="flex min-h-screen items-center justify-center bg-background text-text-muted">
        Loading…
      </div>
    );
  }

  return (
    <DeviceLockGate>
      <div className="flex h-screen bg-background text-text">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <header className="mb-6">
            <h2 className="text-sm text-text-muted">Welcome back,</h2>
            <h1 className="text-2xl font-bold">{data.user.display_name}</h1>
          </header>
          {children}
          <OfflineToast />
        </main>
      </div>
    </DeviceLockGate>
  );
}
