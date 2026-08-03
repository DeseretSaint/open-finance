#!/usr/bin/env node
"use strict";
// og:image generator — renders a 1200×630 social card from the design tokens.
// Usage: node scripts/og-crop.js [outPath]
const sharp = require("sharp");

const OUT = process.argv[2] || "public/og-image.png";
const W = 1200;
const H = 630;

const ACCENT = "#10B981";
const BG = "#FAFAF9";
const TEXT = "#1C1917";
const MUTED = "#78716C";

const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="0" width="8" height="${H}" fill="${ACCENT}"/>
  <rect x="80" y="96" width="96" height="96" rx="24" fill="${ACCENT}"/>
  <text x="128" y="168" font-family="Inter, system-ui, sans-serif" font-size="64" font-weight="700" fill="#FFFFFF" text-anchor="middle">₿</text>
  <text x="80" y="300" font-family="Inter, system-ui, sans-serif" font-size="64" font-weight="700" fill="${TEXT}">Open Finance</text>
  <text x="80" y="356" font-family="Inter, system-ui, sans-serif" font-size="28" fill="${MUTED}">Self-hosted · open source · bring your own Plaid keys — or none</text>
  <text x="80" y="404" font-family="Inter, system-ui, sans-serif" font-size="28" fill="${MUTED}">Bring your own agent — it asks permission before it looks anywhere.</text>
  <text x="80" y="520" font-family="Inter, system-ui, sans-serif" font-size="22" fill="${MUTED}">Bills · debts · goals · 12-month projection — your data on your machine</text>
</svg>`;

(async () => {
  await sharp(Buffer.from(svg)).png().resize(W, H).toFile(OUT);
  console.log(`og:image written to ${OUT} (${W}×${H})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
