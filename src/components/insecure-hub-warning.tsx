"use client";

import { useEffect, useState } from "react";

/**
 * Security guard (M5): the webview can load a hub over HTTP when the user
 * types a LAN IP or an `http://` URL. Tailscale hosts (100.x.y.z / *.ts.net)
 * are encrypted end-to-end, but a raw `http://192.168.x.x` hub is MITM-able.
 * We can't stop Capacitor from loading it (cleartext is allowed for
 * user-entered LAN/Tailscale hosts), but we surface a clear warning so the
 * user knows they're on an untrusted transport.
 */
function isTailscale(host: string): boolean {
  return host.endsWith(".ts.net") || /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isLocal(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".local")
  );
}

export function InsecureHubWarning() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const u = new URL(window.location.origin);
      if (u.protocol === "http:" && !isLocal(u.hostname) && !isTailscale(u.hostname)) {
        setShow(true);
      }
    } catch {
      // ignore
    }
  }, []);

  if (!show) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] bg-[var(--danger-soft)] px-4 py-2 text-center text-xs text-danger"
    >
      You are connected to your hub over <strong>HTTP (unencrypted)</strong>. Anyone on this network
      could intercept your finance data. Use a Tailscale address or HTTPS.
    </div>
  );
}
