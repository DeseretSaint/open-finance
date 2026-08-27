#!/usr/bin/env node
/**
 * Compile src/app/sw.ts into the static export's sw.js.
 *
 * @serwist/next cannot emit the service worker under `next build --turbopack`
 * (turbopack unsupported — see serwist/serwist#54), so for the GitHub Pages
 * browser-solo PWA build we bundle it ourselves here: esbuild compiles
 * src/app/sw.ts, and @serwist/build's getManifest() supplies the same
 * precache manifest the webpack plugin would inject as __SW_MANIFEST.
 *
 * Usage: node scripts/build-sw.mjs   (run AFTER build-mobile.mjs)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { getManifest } from "@serwist/build";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUT = path.join(root, "dist", "mobile", "sw.js");
if (!fs.existsSync(path.join(root, "dist", "mobile", "index.html"))) {
  console.error("dist/mobile missing — run build-mobile.mjs first");
  process.exit(1);
}

// The globDirectory dist/mobile contains BOTH the export output and public/
// assets copied in by Next — precache the HTML pages + root assets.
const manifestResult = await getManifest({
  globDirectory: path.join(root, "dist", "mobile"),
  globPatterns: ["**/*.html", "manifest.webmanifest", "icon.svg", "apple-icon.png", "offline.html"],
  // sw.js / .wasm are runtime-resolved, not precached.
  globIgnores: ["sw.js", "sw.js.map", "sql-wasm.wasm", "404.html"],
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
});
const manifestEntries = manifestResult.manifestEntries;

const result = await build({
  entryPoints: [path.join(root, "src", "app", "sw.ts")],
  bundle: true,
  outfile: OUT,
  format: "iife",
  target: "es2017",
  minify: true,
  sourcemap: false,
  define: { "self.__SW_MANIFEST": JSON.stringify(manifestEntries) },
});

if (!fs.existsSync(OUT)) {
  console.error("sw.js emit failed", result.errors);
  process.exit(1);
}
console.log(`✅ sw.js compiled (${manifestEntries.length} precache entries)`);
