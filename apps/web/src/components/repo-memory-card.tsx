import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MemoryStick } from "lucide-react";
import {
  api,
  type ContainerMetricPoint,
  type WorkloadBaseline,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MemoryChart } from "@/components/container-sheet";
import { formatBytes } from "@/components/server-ui";
import { tx } from "@/lib/i18n";

/**
 * Memory of the linked Dokploy/Coolify app on the repository page — so you
 * see a climb without opening the server Apps tab first.
 */
export function RepoMemoryCard({
  serverId,
  appName,
  isNext,
}: {
  serverId: string;
  appName: string;
  /** Repo stack includes Next.js — show the playbook tip. */
  isNext?: boolean;
}) {
  const [points, setPoints] = useState<ContainerMetricPoint[] | null>(null);
  const [baseline, setBaseline] = useState<WorkloadBaseline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPoints(null);
    setError(null);
    api
      .getContainerMetrics(serverId, appName, 24)
      .then(setPoints)
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      );
    api
      .getServer(serverId)
      .then((s) => setBaseline(s.workloadBaseline ?? null))
      .catch(() => setBaseline(null));
  }, [serverId, appName]);

  const last = points?.length ? points[points.length - 1] : null;
  const usual = baseline?.apps[appName]?.mem ?? null;
  const hot =
    last &&
    usual != null &&
    usual > 0 &&
    last.memBytes >= 2 * usual &&
    last.memBytes - usual >= 256 * 1024 * 1024;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MemoryStick className="size-4 text-muted-foreground" />
          {tx("Memory")}
          {hot && <Badge variant="warning">{tx("above usual")}</Badge>}
        </CardTitle>
        <CardDescription>
          {tx(
            "RSS of the linked container over the last 24 hours. A Next.js app usually settles after warm-up; a line that only climbs between deploys is a leak."
          )}
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link to="/servers/$serverId" params={{ serverId }}>
              {tx("Open server")}
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-muted-foreground">{error}</p>}
        {points == null && !error ? (
          <Skeleton className="h-44 w-full" />
        ) : points && points.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-3 text-sm">
              <span>
                <span className="text-muted-foreground">{tx("Now")}: </span>
                <span className="font-medium tabular-nums">
                  {last ? formatBytes(last.memBytes) : "—"}
                </span>
              </span>
              {usual != null && (
                <span>
                  <span className="text-muted-foreground">
                    {tx("Usual (7 days)")}:{" "}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatBytes(usual)}
                  </span>
                </span>
              )}
            </div>
            <MemoryChart points={points} limit={null} usual={usual} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {tx(
              "No memory samples yet — the server agent needs version 1.6.0+ and a few reports."
            )}
          </p>
        )}
        {(isNext || hot) && (
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            <li>
              {tx(
                "Set a memory limit and NODE_OPTIONS=--max-old-space-size at about 75% of it."
              )}
            </li>
            <li>
              {tx(
                "Check unbounded fetch/ISR caches, in-memory Maps, Payload media, and image optimization concurrency."
              )}
            </li>
            <li>
              {tx(
                "Heap snapshot: node --inspect → Chrome DevTools → Memory, before and after traffic."
              )}
            </li>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
