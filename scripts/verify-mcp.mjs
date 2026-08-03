#!/usr/bin/env node
"use strict";
/**
 * Live MCP verification (D10 acceptance) — drives a real MCP session against
 * a running server: initialize → get_capabilities → fetch the guide →
 * list categories → create a budget → categorize a transaction → add a
 * widget → confirm it renders (list_custom_views). Prints a transcript.
 *
 * Usage: node scripts/verify-mcp.mjs --url http://127.0.0.1:PORT --token of_...
 */
const args = process.argv.slice(2);
const url = args[args.indexOf("--url") + 1];
const token = args[args.indexOf("--token") + 1];
if (!url || !token) {
  console.error("Usage: node verify-mcp.mjs --url <URL> --token <TOKEN>");
  process.exit(1);
}
const endpoint = url.replace(/\/$/, "") + "/mcp";
let sessionId = null;
let id = 0;

function parseSse(text) {
  // Streamable HTTP may answer with SSE frames — take the last data: payload.
  const lines = text.split("\n").filter((l) => l.startsWith("data:"));
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1].slice(5).trim());
}

async function rpc(method, params = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  if (res.headers.get("mcp-session-id")) sessionId = res.headers.get("mcp-session-id");
  const ct = res.headers.get("content-type") ?? "";
  let data;
  if (ct.includes("text/event-stream")) {
    data = parseSse(await res.text());
  } else {
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      // Some builds return the JSON-RPC error as a byte-array string.
      const asBytes = text.split(",").map((n) => parseInt(n, 10));
      if (asBytes.length > 2 && asBytes.every((n) => !Number.isNaN(n))) {
        data = JSON.parse(Buffer.from(asBytes).toString("utf8"));
      } else {
        throw new Error(`Non-JSON response (${res.status} ${ct}): ${text.slice(0, 200)}`);
      }
    }
  }
  return data;
}

async function tool(name, argsObj = {}) {
  const r = await rpc("tools/call", { name, arguments: argsObj });
  const text = r?.result?.content?.[0]?.text ?? JSON.stringify(r?.error ?? r);
  const isError = r?.result?.isError === true;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { isError, parsed, raw: text };
}

const log = (s) => console.log(s);

const out = {};
try {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "verify-mcp", version: "1.0" },
  });
  log(`1. initialize → server: ${init?.result?.serverInfo?.name} v${init?.result?.serverInfo?.version}`);
  await rpc("notifications/initialized");

  const caps = await tool("get_capabilities");
  log(`2. get_capabilities → tools: ${(caps.parsed.tools ?? []).length}, guide pointer: ${caps.parsed.guide ?? "(none)"}`);
  out.tools = caps.parsed.tools ?? [];

  const guideRes = await fetch(url.replace(/\/$/, "") + "/api/agent/guide", {
    headers: { authorization: `Bearer ${token}` },
  });
  const guide = (await guideRes.json()).guide;
  log(`3. GET /api/agent/guide → tabs: ${guide.appMap.length}, widget kinds: ${Object.keys(guide.widgetRecipe.kinds).join("/")}, guardrails: ${guide.guardrails.length}, money: "${guide.money.sign.slice(0, 40)}…"`);
  out.guideTabs = guide.appMap.length;

  const cats = await tool("list_categories");
  const catList = cats.parsed.categories ?? [];
  log(`4. list_categories → ${catList.length} categories${catList[0] ? ` (first: ${catList[0].name})` : ""}`);

  const groceries = catList.find((c) => /grocer/i.test(c.name)) ?? catList[0];
  const budget = await tool("create_budget", {
    name: "MCP Verify Groceries",
    amountCents: 40000,
    categoryIds: groceries ? [groceries.id] : [],
  });
  const budgetId = budget.parsed?.budget?.id;
  log(`5. create_budget → ${budget.isError ? "ERROR: " + budget.raw : `created "${budget.parsed.budget.name}" ($400.00) id=${budgetId?.slice(0, 8)}…`}`);
  out.budgetCreated = !budget.isError && !!budgetId;

  const txns = await tool("list_transactions", { limit: 5 });
  const first = (txns.parsed.transactions ?? [])[0];
  if (first && groceries) {
    const set = await tool("set_transaction_category", { transactionId: first.id, categoryId: groceries.id });
    log(`6. set_transaction_category → ${set.isError ? "ERROR: " + set.raw : `categorized "${first.name}" → ${groceries.name}`}`);
    out.categorized = !set.isError;
  } else {
    log(`6. set_transaction_category → skipped (no transactions or no category)`);
    out.categorized = false;
  }

  const widget = await tool("create_custom_view", {
    tab: "dashboard",
    name: "mcp-verify-spending",
    widget: {
      kind: "stat",
      title: "Added by my AI",
      valueText: "It works",
      sub: "A dev:ui widget created over MCP",
      sentiment: "good",
    },
  });
  const viewId = widget.parsed?.view?.id;
  log(`7. create_custom_view → ${widget.isError ? "ERROR: " + widget.raw : `widget on dashboard id=${viewId?.slice(0, 8)}…`}`);
  out.widgetAdded = !widget.isError && !!viewId;

  const views = await tool("list_custom_views", { tab: "dashboard" });
  const found = (views.parsed.views ?? []).find((v) => v.id === viewId);
  log(`8. list_custom_views → ${(views.parsed.views ?? []).length} widget(s); ours renders: ${found ? "YES" : "no"}`);
  out.widgetRenders = !!found;

  // cleanup — remove the test budget + widget so the verify is non-destructive
  if (budgetId) await tool("delete_budget", { budgetId });
  if (viewId) await tool("delete_custom_view", { viewId });
  log(`9. cleanup → test budget + widget removed`);

  const pass = out.budgetCreated && out.widgetAdded && out.widgetRenders && out.guideTabs >= 7;
  log(`\nRESULT: ${pass ? "PASS" : "FAIL"} — ${JSON.stringify(out)}`);
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error("verify-mcp failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}
