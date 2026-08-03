#!/usr/bin/env node
"use strict";
// Screenshot suite — SEED_DATE-pinned demo captures for docs/CI.
// Usage: node scripts/screenshots.mjs [--seed-date 2026-01-01] [--port 3100]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const seedFlag = args.indexOf("--seed-date");
const SEED_DATE = seedFlag >= 0 ? args[seedFlag + 1] : process.env.SEED_DATE || "2026-01-01";
const portFlag = args.indexOf("--port");
const PORT = portFlag >= 0 ? args[portFlag + 1] : 3100;
const OUT = path.join(root, "public", "screenshots");

const dbPath = path.join(os.tmpdir(), `of-screenshots-${Date.now()}.db`);
const log = (...m) => console.log("[screenshots]", ...m);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  log(`seed date ${SEED_DATE}, port ${PORT}, db ${dbPath}`);

  // migrate + seed
  await run("node", ["migrations/up.js"], { env: { ...process.env, DATABASE_PATH: dbPath } });
  await run("node", ["scripts/seed.js", "--seed-date", SEED_DATE], { env: { ...process.env, DATABASE_PATH: dbPath } });

  // The standalone server needs its static assets beside it (the Dockerfile
  // copies them; a bare local run does not). Mirror them so screenshots work.
  const standaloneStatic = path.join(root, ".next", "standalone", ".next", "static");
  fs.mkdirSync(standaloneStatic, { recursive: true });
  fs.cpSync(path.join(root, ".next", "static"), standaloneStatic, { recursive: true });
  fs.mkdirSync(path.join(root, ".next", "standalone", "public"), { recursive: true });
  fs.cpSync(path.join(root, "public"), path.join(root, ".next", "standalone", "public"), { recursive: true });

  // start the server (standalone build must exist — run `pnpm build` first)
  const server = spawn("node", [path.join(root, ".next", "standalone", "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      DEMO_MODE: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const base = `http://127.0.0.1:${PORT}`;
  await waitFor(base + "/api/health", server);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // demo login
  await page.goto(base + "/demo", { waitUntil: "networkidle" });
  await page.waitForSelector("button:has-text('Enter the demo')", { timeout: 15000 });
  await page.click("text=Enter the demo");
  try {
    await page.waitForURL("**/dashboard", { timeout: 15000 });
  } catch (e) {
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? "no body");
    throw new Error(`demo login failed. page says: ${body}\n${e instanceof Error ? e.message : e}`);
  }

  const shots = [
    ["dashboard", "/dashboard"],
    ["transactions", "/transactions"],
    ["budgets", "/budgets"],
    ["plan", "/plan"],
    ["reports", "/reports"],
    ["settings", "/settings"],
  ];
  for (const [name, route] of shots) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200); // let charts/skeletons settle
    const out = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: out, fullPage: false });
    log(`captured ${out}`);
  }

  // dark mode shot of dashboard
  await page.goto(base + "/dashboard", { waitUntil: "networkidle" });
  await page.click("text=Dark mode");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "dashboard-dark.png") });
  log("captured dashboard-dark.png");

  await browser.close();
  server.kill("SIGTERM");
  log("done");
}

function run(cmd, argv, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${argv.join(" ")} failed: ${err.slice(-500)}`))));
  });
}

function waitFor(url, server) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("server never came up"));
    }, 90_000);
    const interval = setInterval(async () => {
      try {
        const res = await fetch(url);
        if (res.ok) {
          clearInterval(interval);
          clearTimeout(timer);
          resolve();
        }
      } catch {
        /* not up yet */
      }
      if (server.exitCode !== null) {
        clearInterval(interval);
        clearTimeout(timer);
        reject(new Error("server exited early"));
      }
    }, 1000);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
