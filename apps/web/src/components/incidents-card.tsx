import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { api, type RepoIncidents } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/schedule";
import { useT } from "@/lib/i18n";

const pct = (u: number) => `${(Math.floor(u * 10000) / 100).toFixed(2)} %`;
const tone = (u: number) =>
  u >= 0.999 ? "text-success" : u >= 0.99 ? "text-warning" : "text-destructive";

function duration(from: string, to: string | null): string {
  const min = Math.max(
    1,
    Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 60000)
  );
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Uptime of the live URL and every outage, with what was done about it. */
export function IncidentsCard({ repoId }: { repoId: string }) {
  const t = useT();
  const [data, setData] = useState<RepoIncidents | null>(null);
  useEffect(() => {
    api
      .getRepoIncidents(repoId)
      .then(setData)
      .catch(() => setData(null));
  }, [repoId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4" />
          {t("Uptime and outages")}
        </CardTitle>
        <CardDescription>
          {t(
            "The live URL is checked every 5 minutes, every minute while it fails. Two failures in a row are an outage."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!data ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
              <div className="rounded-md border p-2.5">
                <p className="text-xs text-muted-foreground">{t("30 days")}</p>
                <p
                  className={`font-medium tabular-nums ${tone(data.uptime30)}`}
                >
                  {pct(data.uptime30)}
                </p>
              </div>
              <div className="rounded-md border p-2.5">
                <p className="text-xs text-muted-foreground">{t("90 days")}</p>
                <p
                  className={`font-medium tabular-nums ${tone(data.uptime90)}`}
                >
                  {pct(data.uptime90)}
                </p>
              </div>
            </div>
            {(data.locations?.length ?? 0) > 1 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Checked from {n} locations — an outage counts once a second one sees it.",
                    { n: data.locations!.length }
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {data.locations!.map((l) => (
                    <Badge
                      key={l.name}
                      variant={l.ok ? "success" : "destructive-soft"}
                      title={`${l.error ?? (l.httpStatus ? `HTTP ${l.httpStatus}` : "")} · ${formatDateTime(l.checkedAt) ?? ""}`}
                    >
                      {l.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {data.incidents.length === 0 ? (
              <p className="text-muted-foreground">
                {t("No outages recorded.")}
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {data.incidents.slice(0, 20).map((i) => (
                  <li key={i.id} className="space-y-1 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {i.resolvedAt ? (
                        <Badge variant="outline">
                          {duration(i.startedAt, i.resolvedAt)}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          {t("down for {d}", {
                            d: duration(i.startedAt, null),
                          })}
                        </Badge>
                      )}
                      {i.kind === "alert" && (
                        <Badge variant="outline">{t("alert")}</Badge>
                      )}
                      {i.kind === "check" && (
                        <Badge variant="outline">{t("check")}</Badge>
                      )}
                      {i.healAttempts > 0 && (
                        <Badge variant="secondary">{t("restarted")}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(i.startedAt)}
                      </span>
                    </div>
                    {i.cause && (
                      <p className="font-mono text-xs break-all whitespace-pre-line text-muted-foreground">
                        {i.cause}
                      </p>
                    )}
                    {i.timeline.length > 1 && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          {t("What happened")}
                        </summary>
                        <ul className="mt-1 space-y-0.5 pl-4">
                          {i.timeline.map((s, n) => (
                            <li key={n}>
                              {new Date(s.at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              — {s.text}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
