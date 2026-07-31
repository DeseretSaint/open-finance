"use client";

import { useEffect, useState } from "react";

/**
 * Offline honesty (P8a §6.6): connected mode is read-only offline. When the
 * hub is unreachable we show "Connect to hub to edit" so writes never fail
 * silently. The app's TanStack persistence serves last-known data for reads.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function OfflineToast() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center">
      <div className="rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        Offline — read-only. Connect to hub to edit.
      </div>
    </div>
  );
}
