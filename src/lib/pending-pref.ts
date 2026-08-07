"use client";

/**
 * Shared preference: whether pending transactions are included when computing
 * running account balances and net worth. Defaults ON (the app shows the
 * real "what will my balance be" number, including pending charges). Both the
 * Accounts tab and the Overview tab read this so they stay in sync.
 *
 * Persisted in localStorage; read/written from a tiny hook so both pages share
 * one source of truth without a server round-trip.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "of-include-pending";

export function readIncludePending(): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(KEY);
  return v !== "0"; // default true
}

export function useIncludePending(): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(true);
  useEffect(() => {
    setValue(readIncludePending());
  }, []);
  const set = useCallback((next: boolean) => {
    setValue(next);
    if (typeof window !== "undefined") localStorage.setItem(KEY, next ? "1" : "0");
  }, []);
  return [value, set];
}
