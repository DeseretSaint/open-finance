"use client";

import { useEffect, useState } from "react";
import {
  Bitcoin,
  ChartPie,
  Coins,
  CreditCard,
  DollarSign,
  TrendingUp,
  Vault,
  Wallet,
} from "lucide-react";

/**
 * The motif system (D7/D14) — a slow, calm crossfade of hand-built financial
 * motifs drawn with the app's tokens. Shared by the landing, login, register
 * and wizard so the app announces itself as polished before a single number
 * appears.
 *
 * - 8 motifs, 6s per slide, 700ms crossfade, gentle float.
 * - The start slide is seeded randomly per visit — no two logins feel identical.
 * - prefers-reduced-motion → a static accent-tinted panel (no animation).
 * - Pure CSS/transform — never blocks or delays the form beside it.
 */

const MOTIFS = [
  { Icon: CreditCard, label: "Your cards, one place" },
  { Icon: DollarSign, label: "Every dollar, accounted" },
  { Icon: Bitcoin, label: "Investments included" },
  { Icon: ChartPie, label: "See where it goes" },
  { Icon: Wallet, label: "Your wallet, your rules" },
  { Icon: Vault, label: "Your data stays yours" },
  { Icon: TrendingUp, label: "Watch the trend" },
  { Icon: Coins, label: "Budgets that hold" },
] as const;

const SLIDE_MS = 6000;
const FADE_MS = 700;

export function MotifHero({ compact = false }: { compact?: boolean }) {
  // Random start slide per visit.
  const [index, setIndex] = useState(() => Math.floor(Math.random() * MOTIFS.length));
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % MOTIFS.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [reduced]);

  const { Icon, label } = MOTIFS[index];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border bg-surface ${
        compact ? "h-36" : "h-44 sm:h-52"
      }`}
      aria-hidden
    >
      {/* Accent-tinted wash (token-derived, subtle — not a loud gradient) */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 120% at 20% 0%, var(--accent-soft), transparent 60%)" }}
      />
      {/* The crossfading motif */}
      <div
        key={index}
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-accent"
        style={
          reduced
            ? undefined
            : { animation: `motif-in ${FADE_MS}ms ease-out both, motif-float ${SLIDE_MS}ms ease-in-out ${FADE_MS}ms both` }
        }
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 sm:h-20 sm:w-20">
          <Icon size={compact ? 30 : 40} strokeWidth={1.6} />
        </span>
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">{label}</span>
      </div>
    </div>
  );
}
