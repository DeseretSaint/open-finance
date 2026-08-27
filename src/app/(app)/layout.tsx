"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Building2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { Sidebar } from "@/components/sidebar";
import { OfflineToast } from "@/components/offline-toast";
import { hasWindow } from "@/lib/browser-env";
import { DeviceLockGate } from "@/components/device-lock-gate";
import { ErrorBoundary } from "@/components/error-boundary";
import { UpdateBanner } from "@/components/update-banner";

// First-run only: lazy-loaded so its (demo/sample-data) strings stay out of the
// shared app-shell chunk and don't load on every other route.
const OnboardingWizard = dynamic(
  () => import("@/components/onboarding-wizard").then((m) => m.OnboardingWizard),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-text-muted">
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Building2 size={24} />
        </span>
        <p className="text-sm">Loading your finances…</p>
      </div>
    ),
  }
);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: { display_name: string; username: string | null; is_demo?: boolean } }>("/api/auth/me"),
  });
  const onboarding = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => api.get<{ completed: boolean }>("/api/onboarding"),
    enabled: !!data,
  });

  useEffect(() => {
    if (!isLoading && !data) router.replace("/login");
  }, [isLoading, data, router]);

  // Standalone mode: sync immediately on app entry/resume and poll while active.
  useEffect(() => {
    if (!data || onboarding.data?.completed === false || !hasWindow()) return;
    let stop: (() => void) | undefined;
    import("@/lib/solo-auto-sync").then(({ startSoloAutoSync }) => {
      stop = startSoloAutoSync();
    }).catch(() => {});
    return () => stop?.();
  }, [data, onboarding.data?.completed]);

  // When any sync completes (auto or manual), refetch every money query so a
  // freshly-synced pending transaction shows up in the Activity tab without
  // needing a manual page refresh (was: DB updated, UI stayed stale).
  const qc = useQueryClient();
  useEffect(() => {
    if (!hasWindow()) return;
    const onSynced = () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["planning"] });
    };
    window.addEventListener("of:data-synced", onSynced);
    return () => window.removeEventListener("of:data-synced", onSynced);
  }, [qc]);

  // Remote access (share-to-agent): if a remote-access token exists, make sure
  // the native HTTP server on port 8787 is actually listening — it must
  // survive app restarts, not just the toggle moment. No-op on plain web.
  useEffect(() => {
    if (!data || onboarding.data?.completed === false || !hasWindow()) return;
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await api.get<{ enabled: boolean; port: number }>("/api/agent/remote");
        if (cancelled || !remote.enabled) return;
        const plugin = window.RemoteServer;
        if (!plugin?.start) return;
        // Always call start() — it is idempotent and re-registers the native
        // dispatcher, which is a static and is nulled if the process was killed
        // and the service restarted via START_STICKY.
        await plugin.start({ port: remote.port });
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.user.display_name, onboarding.data?.completed]);

  // P11: keep the on-device status notification schedule fresh on every launch
  // (native only — the plugin is a no-op elsewhere).
  useEffect(() => {
    if (!data || onboarding.data?.completed === false) return;
    if (!hasWindow()) return;
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    let cancelled = false;
    (async () => {
      try {
        const prefs = await api.get<{ notifEnabled: boolean; notifFrequency: "daily" | "weekly"; notifTime: string }>(
          "/api/notifications/prefs"
        );
        if (cancelled || !prefs.notifEnabled) return;
        const { syncNotificationSchedule } = await import("@/lib/solo-notifications");
        const { getSoloDb } = await import("@/lib/solo-router");
        const db = await getSoloDb();
        await syncNotificationSchedule(db, {
          enabled: prefs.notifEnabled,
          frequency: prefs.notifFrequency,
          time: prefs.notifTime,
        });
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.user.display_name, onboarding.data?.completed]);

  if (isLoading || !data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-text-muted">
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Building2 size={24} />
        </span>
        <p className="text-sm">Loading your finances…</p>
      </div>
    );
  }

  // First-run walkthrough: gate the app until onboarding completes. Demo users
  // skip it (the demo route marks onboarding complete + is_demo flag).
  if (onboarding.isLoading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-text-muted">
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Building2 size={24} />
        </span>
        <p className="text-sm">Loading your finances…</p>
      </div>
    );
  }
  const isDemo = data.user.is_demo === true;
  if (!isDemo && !onboarding.data?.completed) {
    // The wizard is rendered inside /dashboard, which is normally part of the
    // user-configurable app shell. First-run is an exception: force its entire
    // route dark here so the wizard cannot inherit a stored Light-mode choice.
    return (
      <div className="forced-dark min-h-dvh" style={{ backgroundColor: "#0c0a09", color: "#fafaf9" }}>
        <OnboardingWizard />
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
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-24 pt-4 md:p-8">
          <header className="mb-4 flex items-center gap-3 md:mb-6">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              {(data.user.display_name || "?").trim().charAt(0).toUpperCase()}
            </span>
            <div>
              <h2 className="text-sm text-text-muted">Welcome back,</h2>
              <h1 className="text-2xl font-bold leading-tight">{data.user.display_name}</h1>
            </div>
          </header>
          <ErrorBoundary>{children}</ErrorBoundary>
          <OfflineToast />
        </main>
      </div>
      <UpdateBanner />
    </DeviceLockGate>
  );
}
