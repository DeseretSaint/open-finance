"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import jsQR from "jsqr";
import { api } from "@/lib/api-client";
import { storeHubUrl, storeSessionToken } from "@/lib/mobile-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Mobile pairing (P8a §10.4): the hub shows a QR encoding <hub>/pair?code=….
 * This page scans it (jsqr) or accepts a typed code, swaps it for a session
 * cookie, remembers the hub URL for Reconnect, and drops you on the dashboard.
 */
function PairPage() {
  const router = useRouter();
  const params = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"scan" | "type">("scan");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const urlCode = params.get("code");

  useEffect(() => {
    if (urlCode) {
      setMode("type");
      setCode(urlCode);
    }
  }, [urlCode]);

  // remember the hub URL for Reconnect
  useEffect(() => {
    void storeHubUrl(window.location.origin);
  }, []);

  // camera scanner loop
  useEffect(() => {
    if (mode !== "scan") return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const acceptRef = accept; // stable per effect run; deps intentionally [mode]

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        tick();
      } catch {
        setMode("type");
        setMsg("Camera unavailable — type the code instead.");
      }
    }

    function tick() {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(image.data, image.width, image.height);
          if (qr && qr.data.includes("/pair?code=")) {
            const c = qr.data.split("code=")[1]?.split("&")[0];
            if (c) {
              setMode("type");
              setCode(c);
              void acceptRef(c);
              return;
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }

    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function accept(c: string) {
    if (!c || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.post<{ token: string; expiresAt: string }>("/api/pairing/accept", { code: c, deviceLabel: "Mobile app" });
      // The session was created; set the cookie so the webview is signed in,
      // and store the raw token in Keystore (native) / localStorage (web).
      document.cookie = `of_session=${res.token}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
      await storeSessionToken(res.token);
      setMsg("Paired! Taking you to the dashboard…");
      setTimeout(() => router.push("/dashboard"), 400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Pairing failed.");
      setBusy(false);
      busyRef.current = false;
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Pair your phone</h1>
      <p className="text-center text-sm text-muted-foreground">
        Scan the QR code shown in the hub&apos;s Settings → Hub &amp; phone pairing, or type the code.
      </p>

      {mode === "scan" && (
        <div className="relative aspect-square w-full max-w-xs overflow-hidden rounded-xl border bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}

      {mode === "type" && (
        <div className="w-full space-y-3">
          <Input
            placeholder="Pairing code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button className="w-full" onClick={() => accept(code)} disabled={!code || busy}>
            {busy ? "Pairing…" : "Pair"}
          </Button>
          <button type="button" onClick={() => setMode("scan")} className="w-full text-sm text-muted-foreground underline">
            Scan QR instead
          </button>
        </div>
      )}

      {msg && <p className="text-sm text-emerald-600">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}

export default function PairPageWrapper() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>}>
      <PairPage />
    </Suspense>
  );
}
