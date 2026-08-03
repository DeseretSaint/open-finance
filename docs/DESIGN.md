---
version: alpha
name: Open Finance — Calm Fintech
description: Warm paper surfaces, one accent doing all the work, generous whitespace, precise financial calm.
colors:
  primary: "#10B981"
  on-primary: "#FFFFFF"
  surface: "#FFFFFF"
  surface-muted: "#F5F5F4"
  background: "#FAFAF9"
  border: "#E7E5E4"
  text: "#1C1917"
  text-muted: "#78716C"
  success: "#16A34A"
  warning: "#D97706"
  danger: "#DC2626"
  chart-1: "#10B981"
  chart-2: "#6366F1"
  chart-3: "#F59E0B"
  chart-4: "#EF4444"
  chart-5: "#8B5CF6"
  chart-6: "#06B6D4"
  surface-dark: "#1C1917"
  surface-muted-dark: "#292524"
  background-dark: "#0C0A09"
  border-dark: "#44403C"
  text-dark: "#FAFAF9"
  text-muted-dark: "#A8A29E"
typography:
  body: { fontFamily: Inter Variable, fontSize: 1rem, lineHeight: 1.5, fontWeight: 400 }
  h1: { fontFamily: Inter Variable, fontSize: 1.875rem, fontWeight: 700, letterSpacing: "-0.02em" }
  h2: { fontFamily: Inter Variable, fontSize: 1.5rem, fontWeight: 600, letterSpacing: "-0.015em" }
  h3: { fontFamily: Inter Variable, fontSize: 1.125rem, fontWeight: 600 }
  money: { fontFamily: Inter Variable, fontSize: 1rem, fontWeight: 600, fontFeature: "tnum" }
  label: { fontFamily: Inter Variable, fontSize: 0.75rem, fontWeight: 500, letterSpacing: "0.04em", textTransform: uppercase }
rounded: { sm: 8px, md: 12px, lg: 16px, xl: 24px }
spacing: { xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px, xxl: 48px }
components:
  card: { backgroundColor: "{colors.surface}", rounded: "{rounded.lg}", padding: 24px }
  button-primary: { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", rounded: "{rounded.md}", padding: 12px }
  button-primary-hover: { backgroundColor: "#059669" }
  input: { backgroundColor: "{colors.surface}", rounded: "{rounded.md}", padding: 12px }
  stat-card: { backgroundColor: "{colors.surface}", rounded: "{rounded.lg}", padding: 24px }
  nav-item-active: { backgroundColor: "{colors.surface-muted}", rounded: "{rounded.md}" }
---

## Overview

Calm premium fintech: Monarch's calm × Linear's precision. Warm paper-white
surfaces in light mode, near-black in dark. One accent (default emerald
`#10B981`) does all the emotional work; the user can change it in Settings
(8 presets + custom hex; charts auto-harmonize). Generous whitespace,
`rounded-2xl` cards, hairline borders, Inter with tabular-nums for money,
150ms ease-out micro-motion, number-tween balances, skeleton shimmer.
Nothing flashy; everything considered.

## Colors

- Warm paper light mode; deep charcoal dark mode.
- The accent is the only saturated color at scale; 60/30/10 hierarchy.
- Semantic colors (success/warning/danger) are muted and reserved for meaning.

## Typography

- Inter everywhere. Tabular-nums for ALL money.
- Labels: uppercase, 12px, tracked. Nothing below 12px.

## Layout

- Max-width 1200px content; 24px card padding; 16px grid gap; 240px sidebar.
- Whitespace is a feature.

## Elevation & Depth

- Hairline borders, not heavy shadows:
  `0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.06)`; hover raises one step.

## Shapes

- 16px cards, 12px controls, 8px small elements; user-adjustable 0/8/16/24.

## Motion

- Micro-interactions 120–180ms ease-out; page/tab transitions 280–320ms;
  number tweens 400ms ease-out; skeleton shimmer 1.2s loop.
- Login/landing motif carousel: 6s per slide, 700ms crossfade, gentle 8–12px
  float; a random start slide per visit. Sheets ~260ms with a slight (≤4%)
  overshoot. Animate `transform`/`opacity` only — never layout properties.
- Honor `prefers-reduced-motion` everywhere: everything collapses to instant
  or a minimal fade (the carousel becomes a static accent panel).

## Components

- One high-emphasis action per screen. Destructive actions are text/ghost until
  confirmed. Every state (empty/loading/error) is designed, never raw.

## Do's and Don'ts

- **Do:** left-align money (tabular), positive = green / default text, label-light charts.
- **Don't:** gradients at scale, drop shadows on text, emoji in UI chrome,
  clashing accent pairs, "fun" fonts.
