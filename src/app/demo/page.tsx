"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/sidebar";

/** One-tap demo login (DEMO_MODE must be on; run `pnpm seed` first). */
export default function DemoPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/demo");
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo unavailable.");
      setBusy(false);
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background p-6"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-3">
          <LogoMark size={48} />
        </div>
        <h1 className="text-2xl font-bold text-text">Live demo</h1>
        <p className="mt-2 text-sm text-text-muted">
          Three months of seeded transactions, bills, debts, goals and a projection — no sign-up, no bank connection.
        </p>
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        <Button onClick={enter} disabled={busy} className="mt-6 w-full">
          {busy ? "Entering demo…" : "Enter the demo"}
        </Button>
      </div>
    </main>
  );
}
