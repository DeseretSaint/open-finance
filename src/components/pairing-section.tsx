"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, Link2 } from "lucide-react";

/**
 * Phone → hub pairing (phone side). Reused in Settings (Hub & phone pairing)
 * and the Agents tab so the user can wire a hub without leaving the tab.
 *
 * Flow: tap "Scan QR" and point the camera at the QR the hub shows on its
 * /pair page (or type the hub URL) → we remember the hub URL and redirect to
 * the hub's /pair page, whose accept flow puts the phone into connected mode.
 */
export function PairingSection({
  onPairing,
  compact = false,
}: {
  /** Called when the pairing flow hands off to the hub (useful to update copy). */
  onPairing?: (url: string) => void;
  compact?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  /** Remember this hub URL, then load its /pair page (accept runs on the hub's
   *  origin, wiring the phone into connected mode). */
  function connectToHub(trimmed0: string) {
    const trimmed = trimmed0.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+\..+/.test(trimmed)) {
      setScanErr("That doesn't look like a hub URL — it should start with http:// and include the port, e.g. http://192.168.1.20:3000");
      return;
    }
    setScanErr(null);
    try {
      localStorage.setItem("of-hub-url", trimmed);
    } catch {
      /* storage unavailable — proceed anyway */
    }
    onPairing?.(trimmed);
    window.location.href = `${trimmed}/pair`;
  }

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        tick();
      } catch {
        setScanErr("Camera unavailable — type the hub URL below instead.");
        setScanning(false);
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
          if (qr && qr.data.includes("/pair")) {
            const match = qr.data.match(/^(https?:\/\/[^/]+)\/pair/);
            if (match) {
              stopped = true;
              setScanning(false);
              connectToHub(match[1]);
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
  }, [scanning]);

  return (
    <div className="space-y-3">
      {scanning ? (
        <div className="relative overflow-hidden rounded-xl border border-border bg-black">
          <video ref={videoRef} playsInline muted className="h-56 w-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-40 rounded-2xl border-2 border-[var(--accent)] opacity-80" />
          </div>
          <p className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-1.5 text-center text-xs text-white">
            Point at the QR code on the hub&apos;s pair page
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-2 top-2"
            onClick={() => {
              setScanning(false);
              setScanErr(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setScanning(true)}>
            <Camera size={14} className="mr-1.5" /> Scan QR
          </Button>
          <span className="text-xs text-text-muted">or enter the hub URL manually:</span>
          <div className="flex min-w-56 flex-1 gap-2">
            <Input
              placeholder="http://192.168.1.20:3000"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Hub URL"
            />
            <Button size="sm" variant="secondary" onClick={() => connectToHub(url)} disabled={!url.trim()}>
              <Link2 size={14} className="mr-1.5" /> Connect
            </Button>
          </div>
        </div>
      )}
      {scanErr && <p className="text-xs text-danger">{scanErr}</p>}
      {!compact && (
        <p className="text-xs text-text-muted">
          Pairing stores the hub URL on this phone and loads its pair page — nothing leaves your network. You can also
          pair from <strong className="text-text">Settings → Hub &amp; phone pairing</strong>.
        </p>
      )}
    </div>
  );
}
