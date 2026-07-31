import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";

const execFileAsync = promisify(execFile);

/**
 * Hub detection — the Connection Assistant's eyes. Pure probes: never requires
 * root, never reads secrets, results are session-scoped. Tailscale is best-effort
 * (absent → null); LAN IPs fall back to os.networkInterfaces().
 */

export interface HubDetectResult {
  lanIps: string[];
  tailscale: {
    available: boolean;
    name: string | null;
    ip: string | null;
  } | null;
}

async function run(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 4000, windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function detectHub(): Promise<HubDetectResult> {
  // LAN IPs (non-internal IPv4)
  const lanIps: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) lanIps.push(a.address);
    }
  }

  // Tailscale: `tailscale ip -4` (the machine's 100.x address) + MagicDNS name
  const tailscaleBin = await run("which", ["tailscale"]);
  if (!tailscaleBin) {
    return { lanIps, tailscale: null };
  }
  const ip = await run("tailscale", ["ip", "-4"]);
  const status = await run("tailscale", ["status"]);
  let name: string | null = null;
  if (status) {
    const first = status.split("\n")[0];
    if (first) name = first.split(/\s+/)[1] ?? null;
  }
  return {
    lanIps,
    tailscale: { available: true, name: name ?? null, ip: ip ? ip.split("\n")[0] : null },
  };
}

/** The base URL a phone should use (LAN first, Tailscale preferred for remote). */
export function preferredHubUrl(result: HubDetectResult): string {
  if (result.tailscale?.ip) return `http://${result.tailscale.ip}:3000`;
  if (result.lanIps[0]) return `http://${result.lanIps[0]}:3000`;
  return "http://localhost:3000";
}

// ── Agent detection (P7 uses the same probes; endpoint lands in P6) ─────────

export interface AgentProbe {
  agent: string;
  present: boolean;
  configured: boolean;
}

const AGENT_BINARIES: Array<{ agent: string; binary: string }> = [
  { agent: "hermes", binary: "hermes" },
  { agent: "openclaw", binary: "openclaw" },
  { agent: "claude", binary: "claude" },
  { agent: "codex", binary: "codex" },
  { agent: "cursor", binary: "cursor" },
  { agent: "opencode", binary: "opencode" },
];

/** Config markers: existence + already-configured boolean only. NEVER read contents. */
const AGENT_CONFIG_MARKERS: Array<{ agent: string; path: string; configuredMarker: string }> = [
  { agent: "hermes", path: "~/.hermes/config.yaml", configuredMarker: "~/.hermes" },
  { agent: "openclaw", path: "~/.config/openclaw/", configuredMarker: "~/.config/openclaw" },
  { agent: "claude", path: "~/.claude.json", configuredMarker: "~/.claude" },
  { agent: "claude", path: "~/.config/claude/", configuredMarker: "~/.config/claude" },
  { agent: "cursor", path: "~/.cursor/mcp.json", configuredMarker: "~/.cursor" },
  { agent: "codex", path: "~/.codex/", configuredMarker: "~/.codex" },
  { agent: "opencode", path: "~/.mcp.json", configuredMarker: "~/.mcp.json" },
];

function expandHome(p: string): string {
  return p.replace(/^~/, os.homedir());
}

/**
 * Read-only machine scan. Safety contract: never executes agent binaries, never
 * reads/returns secret values or file contents — only {agent, present, configured}.
 */
export async function detectAgents(): Promise<AgentProbe[]> {
  const result = new Map<string, { present: boolean; configured: boolean }>();

  // Binaries: `which` only (never run the binary itself)
  for (const { agent, binary } of AGENT_BINARIES) {
    const found = await run("which", [binary]);
    const entry = result.get(agent) ?? { present: false, configured: false };
    entry.present = entry.present || found !== null;
    result.set(agent, entry);
  }

  // Config markers: existence check only (fs.stat), never read contents
  for (const { agent, path, configuredMarker } of AGENT_CONFIG_MARKERS) {
    const entry = result.get(agent) ?? { present: false, configured: false };
    try {
      fs.statSync(expandHome(path));
      entry.configured = true;
      // `configured` implies the agent's config dir exists; present can be true via marker too
      entry.present = true;
    } catch {
      // marker missing — but the configuredMarker dir may still exist
      try {
        fs.statSync(expandHome(configuredMarker));
        entry.configured = true;
        entry.present = true;
      } catch {
        // absent
      }
    }
    result.set(agent, entry);
  }

  return AGENT_BINARIES.map(({ agent }) => {
    const e = result.get(agent);
    return { agent, present: e?.present ?? false, configured: e?.configured ?? false };
  });
}
