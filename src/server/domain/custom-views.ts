import { randomUUID } from "node:crypto";
import { apiErrors } from "@/lib/api";
import type { Db } from "@/server/db/adapter";

/**
 * Custom views (dev:ui) — agent-authored dashboard/budgets/reports widgets.
 *
 * A widget is a DECLARATIVE JSON definition — never HTML/JS — that the app
 * renders with its own components and design tokens, so an agent-built widget
 * looks native. The agent fetches data through the normal agent endpoints
 * (subject to its scopes), then describes how to display it.
 *
 * Widget kinds:
 *   stat     — a single money/number figure with a label (+ optional sub-line)
 *   progress — label + spent/limit progress bar
 *   list     — up to 10 rows of { label, valueCents?, hint? }
 *   line     — a simple trend line over { label, value } points
 *   donut    — category breakdown over { label, valueCents, color? } slices
 *
 * Tabs that accept widgets: dashboard, budgets, reports (matches the
 * custom_views.tab CHECK constraint in migration 001).
 */

export const WIDGET_TABS = ["dashboard", "budgets", "reports"] as const;
export type WidgetTab = (typeof WIDGET_TABS)[number];

export const WIDGET_KINDS = ["stat", "progress", "list", "line", "donut"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export interface WidgetDef {
  kind: WidgetKind;
  title: string;
  /** stat */
  valueCents?: number;
  valueText?: string;
  sub?: string;
  sentiment?: "good" | "bad" | "neutral";
  /** progress */
  spentCents?: number;
  limitCents?: number;
  /** list */
  rows?: Array<{ label: string; valueCents?: number; hint?: string }>;
  /** line */
  points?: Array<{ label: string; value: number }>;
  /** donut */
  slices?: Array<{ label: string; valueCents: number; color?: string }>;
}

export interface CustomView {
  id: string;
  tab: WidgetTab;
  name: string;
  widget: WidgetDef;
  position: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  user_id: string;
  token_id: string | null;
  tab: string;
  name: string;
  widget_def: string;
  position: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const MAX_LIST_ROWS = 10;
const MAX_POINTS = 60;
const MAX_SLICES = 12;
const MAX_TITLE = 60;
const MAX_NAME = 60;

function toPublic(row: Row): CustomView {
  return {
    id: row.id,
    tab: row.tab as WidgetTab,
    name: row.name,
    widget: JSON.parse(row.widget_def) as WidgetDef,
    position: row.position,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
}

function cents(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined;
}

/**
 * Validate + normalize an incoming widget definition. Throws 400 with a
 * plain-language reason when the shape is wrong — the agent gets actionable
 * feedback, and nothing malformed ever reaches the UI.
 */
export function validateWidgetDef(input: unknown): WidgetDef {
  if (typeof input !== "object" || input === null) {
    throw apiErrors.badRequest("Widget must be a JSON object.");
  }
  const w = input as Record<string, unknown>;
  const kind = w.kind as WidgetKind;
  if (!WIDGET_KINDS.includes(kind)) {
    throw apiErrors.badRequest(`Widget kind must be one of: ${WIDGET_KINDS.join(", ")}.`);
  }
  const title = cleanText(w.title, MAX_TITLE);
  if (!title) throw apiErrors.badRequest("Widget needs a title.");

  const def: WidgetDef = { kind, title };

  if (kind === "stat") {
    def.valueCents = cents(w.valueCents);
    def.valueText = cleanText(w.valueText, 40);
    def.sub = cleanText(w.sub, 120);
    if (w.sentiment === "good" || w.sentiment === "bad" || w.sentiment === "neutral") def.sentiment = w.sentiment;
    if (def.valueCents === undefined && !def.valueText) {
      throw apiErrors.badRequest("A stat widget needs valueCents or valueText.");
    }
  }
  if (kind === "progress") {
    def.spentCents = cents(w.spentCents) ?? 0;
    def.limitCents = cents(w.limitCents);
    if (def.limitCents === undefined || def.limitCents <= 0) {
      throw apiErrors.badRequest("A progress widget needs a positive limitCents.");
    }
  }
  if (kind === "list") {
    if (!Array.isArray(w.rows)) throw apiErrors.badRequest("A list widget needs a rows array.");
    def.rows = w.rows.slice(0, MAX_LIST_ROWS).map((r, i) => {
      const row = r as Record<string, unknown>;
      const label = cleanText(row?.label, 80);
      if (!label) throw apiErrors.badRequest(`List row ${i + 1} needs a label.`);
      return { label, valueCents: cents(row.valueCents), hint: cleanText(row.hint, 80) };
    });
  }
  if (kind === "line") {
    if (!Array.isArray(w.points) || w.points.length < 2) {
      throw apiErrors.badRequest("A line widget needs at least 2 points.");
    }
    def.points = w.points.slice(0, MAX_POINTS).map((p, i) => {
      const pt = p as Record<string, unknown>;
      const label = cleanText(pt?.label, 20);
      const value = typeof pt?.value === "number" && Number.isFinite(pt.value) ? pt.value : undefined;
      if (!label || value === undefined) throw apiErrors.badRequest(`Line point ${i + 1} needs a label and a numeric value.`);
      return { label, value };
    });
  }
  if (kind === "donut") {
    if (!Array.isArray(w.slices) || w.slices.length === 0) {
      throw apiErrors.badRequest("A donut widget needs a slices array.");
    }
    def.slices = w.slices.slice(0, MAX_SLICES).map((s, i) => {
      const sl = s as Record<string, unknown>;
      const label = cleanText(sl?.label, 40);
      const valueCents = cents(sl?.valueCents);
      if (!label || valueCents === undefined || valueCents < 0) {
        throw apiErrors.badRequest(`Donut slice ${i + 1} needs a label and a non-negative valueCents.`);
      }
      const color = typeof sl?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(sl.color) ? sl.color : undefined;
      return { label, valueCents, color };
    });
  }
  return def;
}

export function createCustomViewsService(db: Db) {
  return {
    async list(userId: string, tab?: WidgetTab): Promise<CustomView[]> {
      const rows = tab
        ? await db.all<Row>(
            "SELECT * FROM custom_views WHERE user_id = ? AND tab = ? AND enabled = 1 ORDER BY position, created_at",
            userId,
            tab
          )
        : await db.all<Row>("SELECT * FROM custom_views WHERE user_id = ? ORDER BY tab, position, created_at", userId);
      return rows.map(toPublic);
    },

    async create(
      userId: string,
      tokenId: string | null,
      input: { tab: string; name: string; widget: unknown; position?: number }
    ): Promise<CustomView> {
      if (!WIDGET_TABS.includes(input.tab as WidgetTab)) {
        throw apiErrors.badRequest(`Widgets can be added to: ${WIDGET_TABS.join(", ")}.`);
      }
      const name = cleanText(input.name, MAX_NAME);
      if (!name) throw apiErrors.badRequest("Widget needs a name.");
      const widget = validateWidgetDef(input.widget);
      const id = randomUUID();
      const now = new Date().toISOString();
      try {
        await db.run(
          `INSERT INTO custom_views (id, user_id, token_id, tab, name, widget_def, position, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          id,
          userId,
          tokenId,
          input.tab,
          name,
          JSON.stringify(widget),
          input.position ?? 0,
          now,
          now
        );
      } catch (e) {
        if (e instanceof Error && /UNIQUE/.test(e.message)) {
          throw apiErrors.badRequest(`A widget named "${name}" already exists on the ${input.tab} tab — update it instead.`);
        }
        throw e;
      }
      const row = await db.get<Row>("SELECT * FROM custom_views WHERE id = ?", id);
      return toPublic(row!);
    },

    async update(
      userId: string,
      id: string,
      input: { name?: string; widget?: unknown; position?: number; enabled?: boolean }
    ): Promise<CustomView> {
      const existing = await db.get<Row>("SELECT * FROM custom_views WHERE id = ? AND user_id = ?", id, userId);
      if (!existing) throw apiErrors.notFound("Widget");
      const name = input.name !== undefined ? cleanText(input.name, MAX_NAME) : existing.name;
      if (!name) throw apiErrors.badRequest("Widget needs a name.");
      const widget = input.widget !== undefined ? validateWidgetDef(input.widget) : (JSON.parse(existing.widget_def) as WidgetDef);
      await db.run(
        "UPDATE custom_views SET name = ?, widget_def = ?, position = ?, enabled = ?, updated_at = ? WHERE id = ?",
        name,
        JSON.stringify(widget),
        input.position ?? existing.position,
        input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
        new Date().toISOString(),
        id
      );
      const row = await db.get<Row>("SELECT * FROM custom_views WHERE id = ?", id);
      return toPublic(row!);
    },

    async remove(userId: string, id: string): Promise<void> {
      const r = await db.run("DELETE FROM custom_views WHERE id = ? AND user_id = ?", id, userId);
      if (r.changes === 0) throw apiErrors.notFound("Widget");
    },
  };
}

export type CustomViewsService = ReturnType<typeof createCustomViewsService>;
