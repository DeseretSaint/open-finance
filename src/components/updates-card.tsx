"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  latestUrl: string | null;
  updateAvailable: boolean;
  dismissed: string | null;
  scheduledAt: string | null;
  running: boolean;
  source: string;
}

/** Settings → Updates: check, update now, schedule, stop-notifying, and the
 *  update-when-ready path (dismissed updates can be un-dismissed here). */
export function UpdatesCard() {
  const qc = useQueryClient();
  const [scheduledAt, setScheduledAt] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["updates"],
    queryFn: () => api.get<UpdateStatus>("/api/updates"),
    refetchInterval: 60_000,
  });
  const s = status.data;

  const act = useMutation({
    mutationFn: async (body: {
      action: "check" | "now" | "scheduled" | "dismiss" | "cancel" | "remind";
      scheduledAt?: string;
    }): Promise<{ status?: UpdateStatus; ok?: boolean }> =>
      body.action === "check"
        ? api.post<{ status: UpdateStatus }>("/api/updates")
        : api.post<{ ok?: boolean }>("/api/updates/decide", body),
    onSuccess: (data) => {
      const st = (data as { status?: UpdateStatus }).status;
      if (st) {
        setMsg(st.updateAvailable ? `Update available: v${st.latestVersion}` : "You're up to date.");
      } else {
        setMsg("Done.");
      }
      setErr(null);
      qc.invalidateQueries({ queryKey: ["updates"] });
    },
    onError: (e) => {
      setErr(e instanceof Error ? e.message : "Failed.");
      qc.invalidateQueries({ queryKey: ["updates"] });
    },
  });

  const upcomingThreeAm = () => {
    const d = new Date();
    d.setHours(3, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(3)}:${pad(0)}`;
  };

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Updates</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        The hub checks GitHub releases (or <code className="rounded bg-muted px-1">UPDATE_CHECK_URL</code>) for newer
        versions. Updating runs <code className="rounded bg-muted px-1">scripts/update.sh</code> — git pull, rebuild,
        restart. Docker installs: set <code className="rounded bg-muted px-1">UPDATE_SCRIPT</code> to a script that
        pulls the image.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge>v{s?.currentVersion ?? "…"}</Badge>
        {s?.latestVersion && (
          <span className="text-text-muted">
            {s.updateAvailable || s.dismissed === s.latestVersion ? (
              <>
                latest: <span className="font-medium">v{s.latestVersion}</span>
                {s.updateAvailable ? (
                  <span className="ml-1 text-emerald-600">· update available</span>
                ) : (
                  <span className="ml-1 text-text-muted">· you stopped notifications for this version</span>
                )}
              </>
            ) : (
              <>· up to date</>
            )}
          </span>
        )}
        {s?.running && <Badge className="bg-amber-500">updating…</Badge>}
        {s?.scheduledAt && (
          <span className="text-text-muted">
            · scheduled for <span className="font-medium">{new Date(s.scheduledAt).toLocaleString()}</span>
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => act.mutate({ action: "check" })} disabled={act.isPending}>
          Check for updates
        </Button>
        {s?.updateAvailable && (
          <>
            <Button onClick={() => act.mutate({ action: "now" })} disabled={act.isPending}>
              Update now
            </Button>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={scheduledAt || upcomingThreeAm()}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-sm"
              />
              <Button
                variant="secondary"
                onClick={() => act.mutate({ action: "scheduled", scheduledAt: new Date(scheduledAt || upcomingThreeAm()).toISOString() })}
                disabled={act.isPending}
              >
                Schedule
              </Button>
            </div>
          </>
        )}
        {s?.dismissed === s?.latestVersion && s?.latestVersion && (
          <Button variant="ghost" onClick={() => act.mutate({ action: "remind" })} disabled={act.isPending}>
            Remind me about v{s.latestVersion}
          </Button>
        )}
        {s?.scheduledAt && (
          <Button variant="ghost" onClick={() => act.mutate({ action: "cancel" })} disabled={act.isPending}>
            Cancel schedule
          </Button>
        )}
        {s?.latestUrl && (
          <a
            href={s.latestUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-text-muted underline underline-offset-2 hover:text-text"
          >
            Release notes
          </a>
        )}
      </div>

      {msg && <p className="mt-3 text-sm text-emerald-600">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Card>
  );
}
