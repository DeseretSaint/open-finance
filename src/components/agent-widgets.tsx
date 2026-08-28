"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardLabel, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/badge";
import { Money } from "@/components/money";

/**
 * Agent widgets (dev:ui) — renders the declarative JSON custom views an agent
 * adds to a tab. Pure JSON → our own components + design tokens; no HTML/JS
 * from the agent is ever executed. Every widget is user-removable inline.
 */

export interface WidgetDef {
  kind: "stat" | "progress" | "list" | "line" | "donut";
  title: string;
  valueCents?: number;
  valueText?: string;
  sub?: string;
  sentiment?: "good" | "bad" | "neutral";
  spentCents?: number;
  limitCents?: number;
  rows?: Array<{ label: string; valueCents?: number; hint?: string }>;
  points?: Array<{ label: string; value: number }>;
  slices?: Array<{ label: string; valueCents: number; color?: string }>;
}

export interface CustomView {
  id: string;
  tab: string;
  name: string;
  widget: WidgetDef;
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

function StatWidget({ w }: { w: WidgetDef }) {
  const sentiment = w.sentiment ?? "neutral";
  const Icon = sentiment === "good" ? TrendingUp : sentiment === "bad" ? TrendingDown : Minus;
  const color = sentiment === "good" ? "text-success" : sentiment === "bad" ? "text-danger" : "text-text";
  return (
    <>
      <div className={`flex items-center gap-2 ${sentiment === "neutral" ? "text-text-muted" : color}`}>
        <Icon size={16} aria-hidden />
        <CardLabel>{w.title}</CardLabel>
      </div>
      <p className={`money mt-1.5 text-2xl font-bold ${color}`}>
        {w.valueCents !== undefined ? <Money cents={w.valueCents} /> : w.valueText}
      </p>
      {w.sub && <p className="mt-1 text-xs text-text-muted">{w.sub}</p>}
    </>
  );
}

function ProgressWidget({ w }: { w: WidgetDef }) {
  const pct = (w.spentCents ?? 0) / (w.limitCents ?? 1);
  return (
    <>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium text-text">{w.title}</span>
        <span className={`money shrink-0 ${pct > 1 ? "font-medium text-danger" : "text-text-muted"}`}>
          <Money cents={w.spentCents ?? 0} /> / <Money cents={w.limitCents ?? 0} />
        </span>
      </div>
      <Progress value={pct} label={`${w.title} usage`} />
    </>
  );
}

function ListWidget({ w }: { w: WidgetDef }) {
  return (
    <>
      <CardTitle>{w.title}</CardTitle>
      <div className="mt-3 space-y-1.5">
        {(w.rows ?? []).map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-text-muted">
              {r.label}
              {r.hint && <span className="ml-1.5 text-xs opacity-75">{r.hint}</span>}
            </span>
            {r.valueCents !== undefined && (
              <span className="money shrink-0 text-text">
                <Money cents={r.valueCents} />
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function LineWidget({ w }: { w: WidgetDef }) {
  const points = w.points ?? [];
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 100;
  const H = 36;
  const coords = points.map((p, i) => {
    const x = points.length === 1 ? W / 2 : (i / (points.length - 1)) * W;
    const y = H - ((p.value - min) / range) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <CardTitle>{w.title}</CardTitle>
        <span className="text-xs text-text-muted">
          {points[0]?.label} – {points[points.length - 1]?.label}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-16 w-full" preserveAspectRatio="none" aria-hidden>
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-text-muted">
        <span className="money">{min.toLocaleString()}</span>
        <span className="money">{max.toLocaleString()}</span>
      </div>
    </>
  );
}

function DonutWidget({ w }: { w: WidgetDef }) {
  const slices = w.slices ?? [];
  const total = slices.reduce((s, x) => s + x.valueCents, 0) || 1;
  // Conic-gradient donut — token-harmonized colors, no JS chart lib needed.
  let acc = 0;
  const stops = slices.map((s, i) => {
    const from = (acc / total) * 360;
    acc += s.valueCents;
    const to = (acc / total) * 360;
    const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length];
    return `${color} ${from.toFixed(1)}deg ${to.toFixed(1)}deg`;
  });
  return (
    <>
      <CardTitle>{w.title}</CardTitle>
      <div className="mt-3 flex items-center gap-4">
        <div
          className="h-20 w-20 shrink-0 rounded-full"
          style={{ background: `conic-gradient(${stops.join(", ")})` }}
          aria-hidden
        >
          <div className="m-[14px] flex h-[52px] w-[52px] items-center justify-center rounded-full bg-surface" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-text-muted">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }}
                  aria-hidden
                />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="money shrink-0 text-text">
                <Money cents={s.valueCents} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function WidgetBody({ w }: { w: WidgetDef }) {
  switch (w.kind) {
    case "stat":
      return <StatWidget w={w} />;
    case "progress":
      return <ProgressWidget w={w} />;
    case "list":
      return <ListWidget w={w} />;
    case "line":
      return <LineWidget w={w} />;
    case "donut":
      return <DonutWidget w={w} />;
  }
}

/**
 * Renders every widget an agent added to `tab`, each removable by the user.
 * Drop <AgentWidgets tab="dashboard" /> into a tab page.
 */
export function AgentWidgets({ tab }: { tab: "dashboard" | "budgets" | "reports" }) {
  const qc = useQueryClient();
  const views = useQuery({
    queryKey: ["custom-views", tab],
    queryFn: () => api.get<{ views: CustomView[] }>(`/api/custom-views?tab=${tab}`),
    retry: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/custom-views/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-views", tab] }),
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed to remove widget."),
  });
  const [confirming, setConfirming] = useState<string | null>(null);

  const list = views.data?.views ?? [];
  const fetchFailed = views.isError && !views.data;
  if (list.length === 0 && !fetchFailed) return null;

  if (fetchFailed) {
    return (
      <div role="alert" className="rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-danger">
        Couldn&apos;t load your widgets{views.error instanceof Error && views.error.message ? ` — ${views.error.message}` : ""}.
        <Button size="sm" variant="secondary" className="ml-2" disabled={views.isFetching} onClick={() => views.refetch()}>
          {views.isFetching ? "Retrying…" : "Try again"}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Widgets from your AI">
      {list.map((v) => (
        <Card key={v.id} className="relative border-accent/15">
          <div className="absolute right-2 top-2">
            {confirming === v.id ? (
              <span className="flex items-center gap-1 text-xs">
                <button
                  onClick={() => remove.mutate(v.id)}
                  disabled={remove.isPending}
                  aria-label={`Remove widget ${v.name}`}
                  className="rounded-md bg-danger/10 px-2 py-1 font-medium text-danger disabled:opacity-60"
                >
                  {remove.isPending ? "Removing…" : "Remove"}
                </button>
                <button onClick={() => setConfirming(null)} className="rounded-md px-2 py-1 text-text-muted">
                  Keep
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirming(v.id)}
                aria-label={`Remove widget ${v.name}`}
                className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                <X size={14} aria-hidden />
              </button>
            )}
            {err && confirming && (
              <span className="ml-2 self-center text-danger">{err}</span>
            )}
          </div>
          <WidgetBody w={v.widget} />
          <p className="mt-2 text-[10px] uppercase tracking-wide text-text-muted/70">Added by your AI · {v.name}</p>
        </Card>
      ))}
    </div>
  );
}
