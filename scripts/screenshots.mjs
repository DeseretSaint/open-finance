#!/usr/bin/env node
"use strict";
// Screenshot suite (D12) — SEED_DATE-pinned demo captures for docs/CI.
// Covers landing, login, wizard, all 8 tabs, settings sections — desktop +
// phone viewports, light + dark.
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

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  log(`seed date ${SEED_DATE}, port ${PORT}, db ${dbPath}`);

  await run("node", ["migrations/up.js"], { env: { ...process.env, DATABASE_PATH: dbPath } });
  await run("node", ["scripts/seed.js", "--seed-date", SEED_DATE], { env: { ...process.env, DATABASE_PATH: dbPath } });

  const standaloneStatic = path.join(root, ".next", "standalone", ".next", "static");
  fs.mkdirSync(standaloneStatic, { recursive: true });
  fs.cpSync(path.join(root, ".next", "static"), standaloneStatic, { recursive: true });
  fs.mkdirSync(path.join(root, ".next", "standalone", "public"), { recursive: true });
  fs.cpSync(path.join(root, "public"), path.join(root, ".next", "standalone", "public"), { recursive: true });

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

  async function shoot(page, name, route, { settle = 1100 } = {}) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(settle);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
    log(`captured ${name}.png`);
  }

  async function setDark(page, dark) {
    // Navigate first so localStorage is accessible (about:blank denies it).
    if (page.url() === "about:blank") await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await page.evaluate((d) => {
      localStorage.setItem("of-dark", d ? "1" : "0");
      document.documentElement.classList.toggle("dark", d);
    }, dark);
  }

  // ── Public surfaces (no auth) ──────────────────────────────────────────
  const pub = await browser.newPage({ viewport: DESKTOP });
  await setDark(pub, true);
  await shoot(pub, "landing", "/");
  await shoot(pub, "login", "/login");
  await pub.waitForTimeout(6500); // one carousel slide later — a second motif frame
  await pub.screenshot({ path: path.join(OUT, "login-2.png") });
  log("captured login-2.png");
  await shoot(pub, "register", "/register");
  await setDark(pub, false);
  await shoot(pub, "landing-light", "/");
  await pub.close();

  // ── Authed app (demo), desktop dark + light ────────────────────────────
  const page = await browser.newPage({ viewport: DESKTOP });
  await page.goto(base + "/demo", { waitUntil: "networkidle" });
  await page.waitForSelector("button:has-text('Enter the demo')", { timeout: 15000 });
  await page.click("text=Enter the demo");
  try {
    await page.waitForURL("**/dashboard", { timeout: 15000 });
  } catch (e) {
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? "no body");
    throw new Error(`demo login failed. page says: ${body}\n${e instanceof Error ? e.message : e}`);
  }

  const tabs = [
    ["dashboard", "/dashboard"],
    ["accounts", "/accounts"],
    ["transactions", "/transactions"],
    ["budgets", "/budgets"],
    ["plan", "/plan"],
    ["reports", "/reports"],
    ["agents", "/agents"],
    ["settings", "/settings"],
  ];
  await setDark(page, true);
  for (const [name, route] of tabs) await shoot(page, name, route);

  await setDark(page, false);
  await shoot(page, "dashboard-light", "/dashboard");
  await shoot(page, "reports-light", "/reports");
  await page.close();

  // ── Phone viewport (dark) ──────────────────────────────────────────────
  const mob = await browser.newPage({ viewport: PHONE, isMobile: true, hasTouch: true });
  await mob.goto(base + "/demo", { waitUntil: "networkidle" });
  await mob.waitForSelector("button:has-text('Enter the demo')", { timeout: 15000 });
  await mob.click("text=Enter the demo");
  await mob.waitForURL("**/dashboard", { timeout: 15000 });
  await setDark(mob, true);
  await shoot(mob, "phone-dashboard", "/dashboard");
  await shoot(mob, "phone-transactions", "/transactions");
  await shoot(mob, "phone-reports", "/reports");
  // The mobile "More" sheet
  await mob.goto(base + "/dashboard", { waitUntil: "networkidle" });
  await mob.click("text=More");
  await mob.waitForTimeout(500);
  await mob.screenshot({ path: path.join(OUT, "phone-more.png") });
  log("captured phone-more.png");
  await mob.close();

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
    }, 500);
    server.on("exit", () => {
      clearInterval(interval);
      clearTimeout(timer);
      reject(new Error("server exited before health check"));
    });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
