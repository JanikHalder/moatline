import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ExternalLink } from "lucide-react";
import {
  api,
  type ContainerService,
  type ImageStatus,
  type ContainerMetricPoint,
  type ServerDetail,
  type ServerFinding,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SeverityBadge } from "@/components/severity-badge";
import { RedeployButton } from "@/components/container-redeploy";
import { ImageVerdictNote } from "@/components/image-badge";
import { LogErrorsCard } from "@/components/log-errors-card";
import { formatBytes } from "@/components/server-ui";
import { useNarrowContent } from "@/hooks/use-narrow-content";
import { formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

export type ContainerRow = NonNullable<
  NonNullable<ServerDetail["lastReport"]>["containers"]
>[number];

const RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;

const chartConfig = {
  memBytes: { label: "Memory", color: "var(--chart-4)" },
} satisfies ChartConfig;

function MemoryChart({
  points,
  limit,
  usual,
}: {
  points: ContainerMetricPoint[];
  limit: number | null;
  usual: number | null;
}) {
  const narrow = useNarrowContent();
  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {tx(
          "The trend appears after a few reports (agent 1.6.0, one every 5 minutes)."
        )}
      </p>
    );
  }
  const data = points.map((p) => ({
    memBytes: p.memBytes,
    t: new Date(p.recordedAt).getTime(),
  }));
  const max = Math.max(...data.map((d) => d.memBytes), usual ?? 0);
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-44 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={["dataMin", "dataMax"]}
          scale="time"
          tickLine={false}
          axisLine={false}
          minTickGap={narrow ? 64 : 48}
          tickFormatter={(t: number) =>
            new Date(t).toLocaleString([], {
              weekday: data.length > 300 ? "short" : undefined,
              hour: "2-digit",
              minute: "2-digit",
            })
          }
        />
        <YAxis
          domain={[0, Math.max(max, limit ?? 0) * 1.05]}
          tickLine={false}
          axisLine={false}
          width={68}
          tickCount={4}
          tickFormatter={(v: number) => formatBytes(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(v) => formatBytes(Number(v))}
              labelFormatter={(_, payload) => {
                const t = payload?.[0]?.payload?.t as number | undefined;
                return t ? new Date(t).toLocaleString() : "";
              }}
            />
          }
        />
        <Area
          dataKey="memBytes"
          type="monotone"
          stroke="var(--color-memBytes)"
          fill="var(--color-memBytes)"
          fillOpacity={0.1}
          strokeWidth={1.75}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums">{value}</p>
    </div>
  );
}

/**
 * One app at a glance: memory over time against its limit and its usual
 * level, and the CVEs in the image it runs.
 */
export function ContainerSheet({
  server,
  container,
  service,
  imageStatus,
  siblings,
  onOpenChange,
}: {
  /** The image against Docker Hub. */
  imageStatus?: ImageStatus;
  server: ServerDetail;
  container: ContainerRow | null;
  /** The Dokploy service behind it, when Dokploy runs it. */
  service?: ContainerService;
  /** Every replica of the same app (memory adds up). */
  siblings: ContainerRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const [hours, setHours] = useState("24");
  const [points, setPoints] = useState<ContainerMetricPoint[] | null>(null);
  const [cves, setCves] = useState<ServerFinding[] | null>(null);
  const app = container ? container.app || container.name : null;
  const image = container?.image ?? null;

  useEffect(() => {
    if (!app) return;
    setPoints(null);
    api
      .getContainerMetrics(server.id, app, Number(hours))
      .then(setPoints)
      .catch(() => setPoints([]));
  }, [server.id, app, hours]);

  useEffect(() => {
    if (!image) return;
    setCves(null);
    api
      // Asked for by image: the whole list of a busy server is capped, and
      // this image's CVEs could fall off its end.
      .getServerFindings(server.id, {
        status: "open",
        source: "trivy",
        prefix: `image|${image}|`,
      })
      .then((all) =>
        setCves(
          all
            .filter((f) => f.fingerprint.startsWith(`image|${image}|`))
            .sort(
              (a, b) =>
                RANK[a.severity] - RANK[b.severity] ||
                a.title.localeCompare(b.title)
            )
        )
      )
      .catch(() => setCves([]));
  }, [server.id, image]);

  const mem = siblings.reduce((s, c) => s + (c.memBytes ?? 0), 0);
  const limits = siblings.map((c) => c.memLimit ?? 0);
  const limit = limits.every((l) => l > 0)
    ? limits.reduce((a, b) => a + b, 0)
    : null;
  // Docker counts one core as 100 %; shown as a share of the whole machine.
  const cores = server.lastReport?.host.cpuCount || 1;
  const cpu = siblings.reduce((s, c) => s + (c.cpuPct ?? 0), 0) / cores;
  const base = app ? server.workloadBaseline?.apps[app] : undefined;
  const usual = base && base.samples >= 288 ? base.mem : null;
  const restarts = siblings.reduce((s, c) => s + (c.restartCount ?? 0), 0);
  const target = server.lastReport?.trivy?.targets.find(
    (t) => t.kind === "image" && t.target === image
  );

  return (
    <Sheet open={!!container} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {container && (
          <>
            <SheetHeader>
              <SheetTitle className="break-all">{app}</SheetTitle>
              <SheetDescription className="font-mono text-xs break-all">
                {image}
              </SheetDescription>
              {service && app && (
                <div className="pt-2">
                  <RedeployButton
                    serverId={server.id}
                    app={app}
                    service={service}
                    variant="full"
                  />
                </div>
              )}
            </SheetHeader>
            <div className="space-y-6 px-4 pb-6 text-sm">
              <ImageVerdictNote status={imageStatus} />
              {siblings.some((c) => c.memBytes != null) ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label={tx("Memory")} value={formatBytes(mem)} />
                  <Stat
                    label={tx("Limit")}
                    value={limit ? formatBytes(limit) : "none"}
                  />
                  <Stat
                    label={tx("Usually")}
                    value={usual ? formatBytes(usual) : tx("learning…")}
                  />
                  <Stat
                    label={tx("CPU ({n} cores)", { n: cores })}
                    value={`${Math.round(cpu)}%`}
                  />
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {tx(
                    "Memory and CPU arrive with agent 1.6.0 — reinstall it from the Setup tab."
                  )}
                </p>
              )}

              {(siblings.some((c) => c.oomKilled) || restarts > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {siblings.some((c) => c.oomKilled) && (
                    <Badge variant="destructive">
                      {tx("killed for running out of memory")}
                    </Badge>
                  )}
                  {restarts > 0 && (
                    <Badge variant="warning">
                      {restarts} {restarts === 1 ? "restart" : "restarts"}
                    </Badge>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{tx("Memory over time")}</p>
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={hours}
                    onValueChange={(v) => v && setHours(v)}
                  >
                    <ToggleGroupItem value="24">24 h</ToggleGroupItem>
                    <ToggleGroupItem value="168">
                      {tx("7 days")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
                {points == null ? (
                  <Skeleton className="h-44 w-full" />
                ) : (
                  <MemoryChart points={points} limit={limit} usual={usual} />
                )}
                <p className="text-xs text-muted-foreground">
                  {tx(
                    "A line that only climbs between deploys is a leak; a Next.js app usually settles after warm-up."
                  )}
                </p>
              </div>

              {app && (
                <LogErrorsCard source={{ serverId: server.id, app }} compact />
              )}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {tx("Vulnerabilities in the image")}
                  </p>
                  {server.lastReport?.trivy?.scannedAt && (
                    <span className="text-xs text-muted-foreground">
                      scanned{" "}
                      {formatRelative(server.lastReport.trivy.scannedAt)}
                    </span>
                  )}
                </div>
                {!target ? (
                  <p className="text-muted-foreground">
                    {tx(
                      "Not scanned yet — Trivy checks running images once a day."
                    )}
                  </p>
                ) : cves == null ? (
                  <Skeleton className="h-20 w-full" />
                ) : cves.length === 0 && target.count > 0 ? (
                  // Counted in the report, not stored yet (older API).
                  <p className="text-muted-foreground">
                    {tx(
                      "Trivy found {n} — the list follows with the next report.",
                      { n: target.count }
                    )}
                  </p>
                ) : cves.length === 0 ? (
                  <Badge variant="success">{tx("no known CVEs")}</Badge>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {tx(
                        "Fix: rebuild on a current base image (e.g. the newest node:22-alpine) and redeploy. Vulnerable npm packages are fixed in the repository — the repository scan opens the update."
                      )}
                    </p>
                    <ul className="divide-y rounded-md border">
                      {cves.slice(0, 100).map((f) => (
                        <li key={f.id} className="space-y-1 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <SeverityBadge severity={f.severity} />
                            <span className="font-medium break-all">
                              {f.title}
                            </span>
                            {f.reference && (
                              <a
                                href={f.reference}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={tx("Advisory")}
                              >
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                          </div>
                          {f.detail && (
                            <p className="text-xs whitespace-pre-line text-muted-foreground">
                              {f.detail}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                    {cves.length > 100 && (
                      <p className="text-xs text-muted-foreground">
                        {cves.length - 100} {tx("more in the Findings tab.")}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
