import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Gauge, RefreshCw } from "lucide-react";
import { api, type PerfRun } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ErrorAlert } from "@/components/error-alert";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

const chartConfig = {
  performance: { label: "Performance", color: "var(--chart-1)" },
  seo: { label: "SEO", color: "var(--chart-2)" },
  accessibility: { label: "Accessibility", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Score colours as Lighthouse uses them. */
function scoreClass(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  return n >= 90
    ? "text-success"
    : n >= 50
      ? "text-warning"
      : "text-destructive";
}

function Metric({
  label,
  value,
  ok,
  hint,
}: {
  label: string;
  value: string;
  ok: boolean | null;
  hint?: string;
}) {
  return (
    <div className="rounded-md border p-2.5" title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-medium tabular-nums",
          ok === false && "text-destructive",
          ok === true && "text-success"
        )}
      >
        {value}
      </p>
    </div>
  );
}

const sec = (ms: number | null) =>
  ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`;

/**
 * Lighthouse of the live site over time, against the go-live budget from
 * the Lighthouse go-live budget. Field data is what real Chrome users
 * measured, when Google has enough of them.
 */
export function PerfCard({ repoId }: { repoId: string }) {
  const [runs, setRuns] = useState<PerfRun[] | null>(null);
  const [strategy, setStrategy] = useState<"mobile" | "desktop">("mobile");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .getPerfRuns(repoId)
      .then(setRuns)
      .catch(() => setRuns([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  const run = () => {
    setRunning(true);
    setError(null);
    api
      .runPerf(repoId)
      .then(load)
      .catch((e) => setError(e instanceof Error ? e.message : tx("Run failed")))
      .finally(() => setRunning(false));
  };

  const mine = (runs ?? []).filter((r) => r.strategy === strategy);
  const ok = mine.filter((r) => !r.error);
  const last = ok[0] ?? null;
  const lastError = mine[0]?.error ?? null;
  const data = [...ok].reverse().map((r) => ({
    t: new Date(r.createdAt).getTime(),
    performance: r.performance,
    seo: r.seo,
    accessibility: r.accessibility,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted-foreground" />
          {tx("Performance")}
          {last && (
            <span className={cn("tabular-nums", scoreClass(last.performance))}>
              {last.performance}
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {tx(
            "Lighthouse via PageSpeed Insights, daily and after every deploy"
          )}
          {last && <> · {formatRelative(last.createdAt)}</>}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={strategy}
            onValueChange={(v) => v && setStrategy(v as "mobile" | "desktop")}
          >
            <ToggleGroupItem value="mobile">{tx("Mobile")}</ToggleGroupItem>
            <ToggleGroupItem value="desktop">{tx("Desktop")}</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" size="sm" onClick={run} disabled={running}>
            {running ? <Spinner /> : <RefreshCw />}
            {running ? tx("Running… (~1 min)") : tx("Run now")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && (
          <ErrorAlert>
            {error}
            {/API key/.test(error) && (
              <>
                {" "}
                <Link to="/settings" className="underline">
                  {tx("Open settings")}
                </Link>
              </>
            )}
          </ErrorAlert>
        )}
        {runs === null ? (
          <Skeleton className="h-40 w-full" />
        ) : !last ? (
          <p className="text-muted-foreground">
            {lastError ??
              tx(
                "No run yet. Runs need a free PageSpeed Insights API key (Settings → Performance)."
              )}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric
                label={tx("Performance")}
                value={String(last.performance ?? "—")}
                ok={last.performance == null ? null : last.performance >= 90}
              />
              <Metric
                label={tx("Accessibility")}
                value={String(last.accessibility ?? "—")}
                ok={
                  last.accessibility == null ? null : last.accessibility >= 95
                }
                hint="Budget ≥ 95"
              />
              <Metric
                label="SEO"
                value={String(last.seo ?? "—")}
                ok={last.seo == null ? null : last.seo >= 100}
                hint="Budget 100"
              />
              <Metric
                label={tx("Best practices")}
                value={String(last.bestPractices ?? "—")}
                ok={null}
              />
              <Metric
                label="LCP"
                value={sec(last.lcpMs)}
                ok={last.lcpMs == null ? null : last.lcpMs <= 2500}
                hint="Largest Contentful Paint — budget ≤ 2.5 s"
              />
              <Metric
                label="CLS"
                value={last.cls == null ? "—" : last.cls.toFixed(2)}
                ok={last.cls == null ? null : last.cls <= 0.1}
                hint="Cumulative Layout Shift — budget ≤ 0.1"
              />
              <Metric
                label="TBT"
                value={last.tbtMs == null ? "—" : `${last.tbtMs} ms`}
                ok={last.tbtMs == null ? null : last.tbtMs <= 300}
                hint="Total Blocking Time — budget ≤ 300 ms"
              />
              <Metric
                label={tx("Page weight")}
                value={
                  last.bytes == null
                    ? "—"
                    : `${(last.bytes / 1024 / 1024).toFixed(1)} MB`
                }
                ok={last.bytes == null ? null : last.bytes <= 3 * 1024 * 1024}
                hint="Budget < 3 MB"
              />
            </div>
            {(last.fieldLcpMs != null || last.fieldInpMs != null) && (
              <p className="text-xs text-muted-foreground">
                {tx("Real Chrome users (75th percentile): LCP")}{" "}
                {sec(last.fieldLcpMs)}
                {last.fieldInpMs != null && ` · INP ${last.fieldInpMs} ms`}
                {last.fieldCls != null && ` · CLS ${last.fieldCls.toFixed(2)}`}
              </p>
            )}
            {data.length >= 2 && (
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-40 w-full"
              >
                <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={48}
                    tickFormatter={(t: number) =>
                      new Date(t).toLocaleDateString([], {
                        day: "2-digit",
                        month: "2-digit",
                      })
                    }
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                    tickCount={3}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) => {
                          const t = payload?.[0]?.payload?.t as
                            | number
                            | undefined;
                          return t ? new Date(t).toLocaleString() : "";
                        }}
                      />
                    }
                  />
                  {(["performance", "seo", "accessibility"] as const).map(
                    (k) => (
                      <Line
                        key={k}
                        dataKey={k}
                        type="monotone"
                        stroke={`var(--color-${k})`}
                        strokeWidth={1.75}
                        dot={false}
                      />
                    )
                  )}
                </LineChart>
              </ChartContainer>
            )}
            <p className="text-xs text-muted-foreground">
              {tx("Measured on")} {last.url}
              {last.commit && (
                <>
                  {" "}
                  {tx("· commit")} {last.commit.slice(0, 7)}
                </>
              )}
              {tx(". Budget: the Lighthouse go-live budget.")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
