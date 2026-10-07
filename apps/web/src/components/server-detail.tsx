import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MaintenanceButton } from "@/components/maintenance-button";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import {
  Activity,
  Box,
  CalendarClock,
  Cpu,
  Globe,
  LockKeyhole,
  Network,
  HardDrive,
  MemoryStick,
  PackageCheck,
  Radar,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useNarrowContent } from "@/hooks/use-narrow-content";
import { toast } from "sonner";
import {
  api,
  type AgentInstall,
  type BackupCheck,
  type FindingSource,
  type RepoListItem,
  type ServerDetail as ServerDetailData,
  type ServerFinding,
  type ServerMetricPoint,
  type ServerScanRun,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { DockerDiskCard } from "@/components/docker-disk-card";
import { StorageCard, fullIn } from "@/components/storage-card";
import { LogErrorsCard } from "@/components/log-errors-card";
import {
  AgentInstallPanel,
  AgentStatusBadge,
  CodeLine,
  type Enrollment,
  FindingsTable,
  SOURCE_LABEL,
  formatBytes,
} from "@/components/server-ui";
import { formatDateTime, formatRelative } from "@/lib/schedule";
import {
  AutoUpdateStep,
  BuildRunnerStep,
  HardenStep,
} from "@/components/server-setup";
import { SecurityCard } from "@/components/server-security";
import {
  BackupChecksEditor,
  BackupsCard,
  DockerAppsCard,
} from "@/components/server-workloads";
import { tx } from "@/lib/i18n";

const NUCLEI_SCHEDULES = [
  { value: "off", label: "Manual only", cron: null as string | null },
  { value: "daily", label: "Daily (02:00)", cron: "0 2 * * *" },
  { value: "weekly", label: "Weekly (Sun 02:00)", cron: "0 2 * * 0" },
];

const chartConfig = {
  cpuPct: { label: "CPU", color: "var(--primary)" },
  memoryPct: { label: "Memory", color: "var(--chart-4)" },
  diskPct: { label: "Disk", color: "var(--chart-2)" },
} satisfies ChartConfig;

function MetricsChart({ points }: { points: ServerMetricPoint[] }) {
  // A phone fits three or four time labels; the desktop spacing crowds them.
  const narrow = useNarrowContent();
  if (points.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {tx("The trend appears after a few reports (one every 5 minutes).")}
      </p>
    );
  }
  const data = points.map((p) => ({
    ...p,
    t: new Date(p.recordedAt).getTime(),
  }));
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-48 w-full sm:h-56"
    >
      <AreaChart
        data={data}
        margin={{ left: narrow ? -8 : 0, right: 8, top: 8 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={["dataMin", "dataMax"]}
          scale="time"
          tickLine={false}
          axisLine={false}
          minTickGap={narrow ? 72 : 48}
          tickFormatter={(t: number) =>
            new Date(t).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          }
        />
        <YAxis
          // Load can exceed 100% of the cores; never clip the line that matters.
          domain={[0, (max: number) => Math.max(100, Math.ceil(max / 25) * 25)]}
          tickLine={false}
          axisLine={false}
          width={narrow ? 40 : 44}
          tickCount={narrow ? 3 : 5}
          tickFormatter={(v: number) => `${v}%`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const t = payload?.[0]?.payload?.t as number | undefined;
                return t ? new Date(t).toLocaleString() : "";
              }}
            />
          }
        />
        {(["cpuPct", "memoryPct", "diskPct"] as const).map((key) => (
          <Area
            key={key}
            dataKey={key}
            type="monotone"
            stroke={`var(--color-${key})`}
            fill={`var(--color-${key})`}
            fillOpacity={0.08}
            strokeWidth={1.75}
            dot={false}
            connectNulls
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}

function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n)}%`;
}

/**
 * What the outside world can reach on the server's own address — the check
 * that works without installing anything.
 */
function ExternalCheckCard({
  server,
  onChecked,
}: {
  server: ServerDetailData;
  onChecked: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const n = server.networkState;
  const run = async () => {
    setChecking(true);
    try {
      await api.runNetworkCheck(server.id);
      onChecked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Check failed"));
    } finally {
      setChecking(false);
    }
  };
  const open = n?.ports.filter((p) => p.open) ?? [];
  const missing = n?.ports.filter((p) => p.expected && !p.open) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="size-4" />
          {tx("External check")}
        </CardTitle>
        <CardDescription>
          <span className="font-mono">{server.address}</span>
          {n?.resolved.length && n.resolved[0] !== server.address
            ? ` → ${n.resolved.join(", ")}`
            : ""}
          {n?.checkedAt &&
            ` · ${tx("checked {when}", { when: formatRelative(n.checkedAt) ?? "" })}`}
          {tx(" · every 15 minutes")}
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={run} disabled={checking}>
            {checking ? <Spinner /> : <RefreshCw />}
            {tx("Check now")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!n ? (
          <p className="text-muted-foreground">{tx("Not checked yet.")}</p>
        ) : n.error ? (
          <ErrorAlert>{n.error}</ErrorAlert>
        ) : (
          <>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {tx("Reachable from the internet")}
              </p>
              {open.length === 0 ? (
                <Badge variant="destructive">{tx("nothing answers")}</Badge>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {open.map((p) => (
                    <Badge
                      key={p.port}
                      variant={p.expected ? "success" : "destructive-soft"}
                      title={
                        p.expected
                          ? tx("Expected")
                          : tx("Not in the expected ports — see Findings")
                      }
                    >
                      {p.port} · {p.service}
                      {p.latencyMs != null && (
                        <span className="opacity-60">{p.latencyMs} ms</span>
                      )}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {missing.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {tx("Expected but not reachable")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {missing.map((p) => (
                    <Badge key={p.port} variant="destructive">
                      {p.port} · {p.service}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {n.tls && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <LockKeyhole className="size-3.5 text-muted-foreground" />
                <span>{tx("TLS on 443:")}</span>
                {n.tls.authorized === false ? (
                  <Badge variant="destructive-soft">
                    {n.tls.error ?? tx("not trusted")}
                  </Badge>
                ) : n.tls.authorized === true ? (
                  <Badge variant="success">valid</Badge>
                ) : (
                  <Badge variant="outline">{tx("IP — name not checked")}</Badge>
                )}
                {n.tls.daysRemaining != null && (
                  <span className="text-muted-foreground">
                    {tx("expires in")} {n.tls.daysRemaining} days
                    {n.tls.issuer ? ` · ${n.tls.issuer}` : ""}
                  </span>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {tx("Checked:")} {n.ports.length}{" "}
              {tx(
                "common ports (SSH, web, databases, Docker API, Redis, admin panels…). Expected:"
              )}{" "}
              {server.expectedPorts.join(", ") || "none"}{" "}
              {tx("— change under Settings.")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Whether the server patches itself — and if not, why. The question behind
 * every "security updates pending" finding.
 */
function AutoUpdatesCard({ server }: { server: ServerDetailData }) {
  const u = server.lastReport?.updates;
  const ua = u?.unattended;
  const row = (label: string, value: ReactNode) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{tx(label)}</span>
      <span className="text-right">{value}</span>
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4" />
          {tx("Automatic updates")}
        </CardTitle>
        <CardDescription>
          {tx(
            "unattended-upgrades installs security updates on its own; this shows whether it actually does."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!u ? (
          <p className="text-muted-foreground">{tx("No data yet.")}</p>
        ) : u.autoUpdates === false ? (
          <ErrorAlert title={tx("Off")}>
            {tx(
              "Security updates only arrive when someone installs them by hand. Run save-server/scripts/auto-update.sh on the server."
            )}
          </ErrorAlert>
        ) : (
          <>
            {row(
              "Last run",
              ua?.lastRunAt ? (
                <span className="flex items-center gap-2">
                  {formatRelative(ua.lastRunAt)}
                  <Badge
                    variant={
                      ua.lastResult === "error" ? "destructive-soft" : "success"
                    }
                  >
                    {ua.lastResult === "error" ? tx("failed") : tx("ok")}
                  </Badge>
                </span>
              ) : (
                tx("never")
              )
            )}
            {row(
              "Next run",
              ua?.nextRunAt ? (
                <span title={formatDateTime(ua.nextRunAt) ?? undefined}>
                  {formatRelative(ua.nextRunAt)}
                </span>
              ) : (
                "—"
              )
            )}
            {row(
              "Pending security updates",
              u.security > 0 ? (
                <Badge variant="warning">{u.security}</Badge>
              ) : (
                <Badge variant="success">0</Badge>
              )
            )}
            {row(
              "Restart",
              !u.rebootRequired ? (
                <Badge variant="success">{tx("not needed")}</Badge>
              ) : ua?.rebootScheduledAt ? (
                <span title={formatDateTime(ua.rebootScheduledAt) ?? undefined}>
                  {tx("scheduled {when}", {
                    when: formatRelative(ua.rebootScheduledAt) ?? "",
                  })}
                </span>
              ) : (
                <Badge variant="warning">
                  {u.rebootRequiredSince
                    ? tx("needed since {when}", {
                        when: formatRelative(u.rebootRequiredSince) ?? "",
                      })
                    : tx("needed")}
                </Badge>
              )
            )}
            {ua?.lastError && (
              <p className="text-xs text-destructive">{ua.lastError}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type TabName =
  | "overview"
  | "apps"
  | "security"
  | "maintenance"
  | "findings"
  | "settings"
  | "agent";

/** The most important numbers, and one line per area with what needs a look. */
function OverviewTab({
  server,
  metrics,
  onOpen,
}: {
  server: ServerDetailData;
  metrics: ServerMetricPoint[];
  onOpen: (tab: TabName) => void;
}) {
  const r = server.lastReport;
  const host = r?.host;

  return (
    <div className="space-y-6">
      {server.agentStatus === "stale" && (
        <Alert variant="warning">
          <Activity />
          <AlertTitle>{tx("The agent stopped reporting")}</AlertTitle>
          <AlertDescription>
            {tx("Everything below is from")}{" "}
            {formatDateTime(server.lastReportAt)}
            {tx(
              ". The server, the agent or its timer may be down — check"
            )}{" "}
            <code className="font-mono">
              systemctl status pc-agent-metrics.timer
            </code>
            .
          </AlertDescription>
        </Alert>
      )}

      {server.agentStatus === "never" && server.address ? (
        <Alert>
          <Activity />
          <AlertTitle>
            {tx("OS version, updates, load and Trivy need the agent")}
          </AlertTitle>
          <AlertDescription>
            {tx(
              "From the outside only ports and certificates are visible. What is installed and what needs updating can only be read on the server itself — install the agent under the Setup tab."
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={host?.cpu ? "CPU" : tx("CPU (load)")}
          icon={Cpu}
          value={pct(host?.cpuPct)}
          tone={
            host && host.cpuPct >= server.cpuThreshold
              ? "destructive"
              : "default"
          }
          description={
            host?.cpu
              ? [
                  tx("of {n} cores", { n: host.cpuCount }),
                  host.cpu.iowaitPct >= 5
                    ? tx("{pct}% waiting for the disk", {
                        pct: Math.round(host.cpu.iowaitPct),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : host
                ? tx(
                    "load {load} on {n} cores (agent 1.8.0 measures real CPU use)",
                    {
                      load: host.load.map((l) => l.toFixed(2)).join(" / "),
                      n: host.cpuCount,
                    }
                  )
                : undefined
          }
        />
        <StatCard
          label={tx("Memory")}
          icon={MemoryStick}
          value={pct(host?.memoryPct)}
          tone={
            host && host.memoryPct >= server.memoryThreshold
              ? "destructive"
              : "default"
          }
          description={
            host
              ? tx("{used} of {total}", {
                  used: formatBytes(
                    host.memory.totalBytes - host.memory.availableBytes
                  ),
                  total: formatBytes(host.memory.totalBytes),
                })
              : undefined
          }
        />
        <StatCard
          label={tx("Fullest disk")}
          icon={HardDrive}
          value={pct(host?.diskPct)}
          tone={
            host?.diskPct != null && host.diskPct >= server.diskThreshold
              ? "destructive"
              : "default"
          }
          description={
            host?.disks.length
              ? host.disks.length === 1
                ? tx("1 disk")
                : tx("{n} disks", { n: host.disks.length })
              : undefined
          }
        />
        <StatCard
          label={tx("Security updates")}
          icon={PackageCheck}
          value={r?.updates ? r.updates.security : "—"}
          tone={r?.updates?.security ? "warning" : "success"}
          description={
            r?.updates
              ? [
                  tx("{n} updates in total", { n: r.updates.pending }),
                  r.updates.rebootRequired ? tx("restart needed") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        />
      </div>

      <AtAGlance server={server} onOpen={onOpen} />

      <Card>
        <CardHeader>
          <CardTitle>{tx("Load over the last 24 hours")}</CardTitle>
          <CardDescription>
            {tx("CPU is the 1-minute load per core. Thresholds: CPU")}{" "}
            {server.cpuThreshold}
            {tx("%, memory")} {server.memoryThreshold}
            {tx("%, disk")} {server.diskThreshold}%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MetricsChart points={metrics} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Containers, the applications on the server, their errors and monitors. */
function AppsTab({
  server,
  runs,
  onStart,
  starting,
}: {
  server: ServerDetailData;
  runs: ServerScanRun[];
  onStart: () => void;
  starting: boolean;
}) {
  const kuma = server.kumaState;
  return (
    <div className="space-y-6">
      <DockerAppsCard server={server} />
      <LogErrorsCard source={{ serverId: server.id }} />
      <LiveAppsTab
        server={server}
        runs={runs}
        onStart={onStart}
        starting={starting}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4" />
            {tx("Uptime Kuma")}
          </CardTitle>
          <CardDescription>
            {kuma?.checkedAt
              ? tx("Checked {when}", {
                  when: formatRelative(kuma.checkedAt) ?? "",
                })
              : tx("Monitors of the applications on this server.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {kuma?.error && <ErrorAlert>{kuma.error}</ErrorAlert>}
          {!kuma?.monitors?.length ? (
            <p className="text-muted-foreground">
              {tx(
                "No monitors attached. Configure Uptime Kuma under Settings, then link applications with a live URL or pick monitors in this server's settings."
              )}
            </p>
          ) : (
            kuma.monitors.map((m) => (
              <div
                key={m.name}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">{m.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {m.responseTimeMs != null && `${m.responseTimeMs} ms`}
                  <Badge
                    variant={
                      m.statusLabel === "up"
                        ? "success"
                        : m.statusLabel === "down"
                          ? "destructive"
                          : "warning"
                    }
                  >
                    {m.statusLabel ?? "unknown"}
                  </Badge>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** What protects the server, and what found holes in it. */
function SecurityTab({
  server,
  onReload,
}: {
  server: ServerDetailData;
  onReload: () => void;
}) {
  const r = server.lastReport;
  const cs = r?.crowdsec;
  const wazuh = server.wazuhState;
  return (
    <div className="space-y-6">
      {server.address && (
        <ExternalCheckCard server={server} onChecked={onReload} />
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SecurityCard server={server} onChanged={onReload} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="size-4" />
              {tx("CrowdSec")}
            </CardTitle>
            <CardDescription>
              {tx("Attacks detected and blocked on this server.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!cs ? (
              <p className="text-muted-foreground">{tx("No data yet.")}</p>
            ) : !cs.available ? (
              <ErrorAlert title={tx("Not protected")}>
                {cs.error ?? tx("CrowdSec is not running.")}
              </ErrorAlert>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {tx("Alerts (24h)")}
                    </p>
                    <p className="tabular text-2xl font-semibold">
                      {cs.alerts24h ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {tx("Active bans")}
                    </p>
                    <p className="tabular text-2xl font-semibold">
                      {cs.activeDecisions ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {tx("Bouncers")}
                    </p>
                    <p className="tabular text-2xl font-semibold">
                      {cs.bouncers.length}
                    </p>
                  </div>
                </div>
                {cs.topScenarios.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      {tx("Top scenarios")}
                    </p>
                    {cs.topScenarios.slice(0, 5).map((s) => (
                      <div
                        key={s.scenario}
                        className="flex justify-between gap-2 font-mono text-xs"
                      >
                        <span className="truncate">{s.scenario}</span>
                        <span className="tabular">{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="size-4" />
              {tx("Trivy")}
            </CardTitle>
            <CardDescription>
              {r?.trivy
                ? tx("Last scan {when}", {
                    when: formatRelative(r.trivy.scannedAt) ?? "",
                  })
                : tx("Runs daily on the server; nothing reported yet.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!r?.trivy ? (
              <p className="text-muted-foreground">{tx("No scan yet.")}</p>
            ) : !r.trivy.available ? (
              <ErrorAlert title={tx("Not scanned")}>
                {r.trivy.error ?? tx("Trivy is not installed.")}
              </ErrorAlert>
            ) : (
              <>
                {r.trivy.targets.map((t) => (
                  <div
                    key={t.target}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0 truncate font-mono text-xs">
                      {t.kind === "host" ? tx("Host (OS packages)") : t.target}
                      {t.containers.length > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {t.containers.join(", ")}
                        </span>
                      )}
                    </span>
                    <Badge
                      variant={t.count ? "destructive-soft" : "success"}
                      className="shrink-0"
                    >
                      {t.count}
                    </Badge>
                  </div>
                ))}
                {r.trivy.error && (
                  <p className="text-xs text-warning">{r.trivy.error}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              {tx("Wazuh")}
            </CardTitle>
            <CardDescription>
              {wazuh?.checkedAt
                ? tx("Checked {when}", {
                    when: formatRelative(wazuh.checkedAt) ?? "",
                  })
                : tx(
                    "Agent status and hardening score from the Wazuh manager."
                  )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {wazuh?.error && <ErrorAlert>{wazuh.error}</ErrorAlert>}
            {!server.wazuhAgentId ? (
              <p className="text-muted-foreground">
                {tx("No Wazuh agent ID set for this server.")}
              </p>
            ) : !wazuh?.agent ? (
              <p className="text-muted-foreground">{tx("No data yet.")}</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span>
                    {tx("Agent")} {wazuh.agent.id}
                    {wazuh.agent.version ? ` · ${wazuh.agent.version}` : ""}
                  </span>
                  <Badge
                    variant={
                      wazuh.agent.status === "active"
                        ? "success"
                        : "destructive-soft"
                    }
                  >
                    {wazuh.agent.status ?? "unknown"}
                  </Badge>
                </div>
                {wazuh.sca?.map((p) => (
                  <div
                    key={p.policyId}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 truncate">{p.name}</span>
                    <Badge
                      variant={
                        p.score == null
                          ? "outline"
                          : p.score >= 80
                            ? "success"
                            : p.score >= 50
                              ? "warning"
                              : "destructive-soft"
                      }
                    >
                      {p.score == null ? "—" : `${p.score}%`}
                    </Badge>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Keeping it running: system and disks, updates, storage, backups. */
function MaintenanceTab({
  server,
  onSaved,
}: {
  server: ServerDetailData;
  onSaved: () => void;
}) {
  const r = server.lastReport;
  const host = r?.host;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AutoUpdatesCard server={server} />
        <BackupsCard server={server} />
      </div>
      <StorageCard server={server} onSaved={onSaved} />
      <DockerDiskCard server={server} />
      {host && (
        <Card className="gap-0 overflow-hidden pb-0">
          <CardHeader className="border-b pb-4 [.border-b]:pb-4">
            <CardTitle>{tx("System")}</CardTitle>
            <CardDescription>
              {[host.os, host.kernel && `kernel ${host.kernel}`]
                .filter(Boolean)
                .join(" · ")}
              {host.uptimeSeconds != null &&
                ` · ${tx("running for {n} days", { n: Math.floor(host.uptimeSeconds / 86400) })}`}
            </CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-6">{tx("Filesystem")}</TableHead>
                <TableHead>{tx("Used")}</TableHead>
                <TableHead className="pr-6 text-right">{tx("Size")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {host.disks.map((d) => {
                const p = d.totalBytes ? (d.usedBytes / d.totalBytes) * 100 : 0;
                const full = fullIn(
                  r?.storageForecast?.[`disk:${d.mount}`]?.daysLeft
                );
                return (
                  <TableRow key={d.mount}>
                    <TableCell className="pl-6 font-mono text-xs break-all whitespace-normal">
                      {d.mount}
                      {d.fsType && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({d.fsType})
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={
                        p >= server.diskThreshold
                          ? "font-medium text-destructive"
                          : undefined
                      }
                    >
                      {Math.round(p)}%
                      {full && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {tx("full {when}", { when: full })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-6 text-right text-xs text-muted-foreground">
                      {formatBytes(d.usedBytes)} / {formatBytes(d.totalBytes)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {r?.updates && r.updates.packages.length > 0 && (
            <div className="border-t px-6 py-4 text-sm">
              <p className="mb-2 font-medium">
                {tx("Pending updates (")}
                {r.updates.manager})
              </p>
              <div className="flex flex-wrap gap-1">
                {[...r.updates.packages]
                  .sort((a, b) => Number(!!b.security) - Number(!!a.security))
                  .slice(0, 60)
                  .map((p) => (
                    <Badge
                      key={p.name}
                      variant={p.security ? "destructive-soft" : "outline"}
                      title={
                        p.candidate
                          ? `${p.current ?? "?"} → ${p.candidate}`
                          : undefined
                      }
                    >
                      {p.name}
                    </Badge>
                  ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const SOURCE_FILTERS: Array<{ value: "all" | FindingSource; label: string }> = [
  { value: "all", label: "All" },
  { value: "host", label: "Host" },
  { value: "trivy", label: "Trivy" },
  { value: "nuclei", label: "Nuclei" },
  { value: "crowdsec", label: "CrowdSec" },
  { value: "kuma", label: "Kuma" },
  { value: "wazuh", label: "Wazuh" },
  { value: "security", label: "Security" },
  { value: "network", label: "External" },
  { value: "provider", label: "Hetzner" },
  { value: "dokploy", label: "Dokploy" },
  { value: "registry", label: "Docker Hub" },
  { value: "coolify", label: "Coolify" },
  { value: "platform", label: "Platforms" },
  { value: "heartbeat", label: "Agent" },
];

type Tone = "ok" | "warn" | "bad" | "none";
const TONE_DOT: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  none: "bg-muted-foreground/40",
};

/** One line per area: how it stands, and where to look. */
function AtAGlance({
  server,
  onOpen,
}: {
  server: ServerDetailData;
  onOpen: (tab: TabName) => void;
}) {
  const r = server.lastReport;
  const containers = r?.containers ?? [];
  const sick = containers.filter(
    (c) => c.state === "restarting" || c.health === "unhealthy"
  ).length;
  const down = server.applications.filter((a) => a.liveStatus === "down");
  const serious = server.counts.critical + server.counts.high;
  const cs = r?.crowdsec;
  const u = r?.updates;
  const disk = r?.host.diskPct ?? null;
  const free =
    (r?.dockerDisk?.buildCache?.reclaimableBytes ?? 0) +
    (r?.dockerDisk?.images?.reclaimableBytes ?? 0);
  const backupsBad = (r?.backups ?? []).filter((b) => b.error).length;

  const rows: Array<{
    tab: TabName;
    label: string;
    tone: Tone;
    text: string;
  }> = [
    {
      tab: "apps",
      label: tx("Apps"),
      tone: down.length || sick ? "bad" : containers.length ? "ok" : "none",
      text: [
        down.length
          ? tx("{names} offline", { names: down.map((a) => a.name).join(", ") })
          : null,
        `${containers.length} ${tx("containers")}`,
        sick ? `${sick} ${tx("unhealthy")}` : null,
        `${server.applications.length} ${tx("sites")}`,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      tab: "security",
      label: tx("Security"),
      tone: serious ? "bad" : cs && !cs.available ? "warn" : r ? "ok" : "none",
      text: [
        serious
          ? `${server.counts.critical} ${tx("critical")}, ${server.counts.high} ${tx("high")}`
          : tx("nothing critical open"),
        cs
          ? cs.available
            ? `CrowdSec: ${cs.activeDecisions ?? 0} ${tx("bans")}`
            : tx("CrowdSec not running")
          : null,
        r?.trivy?.scannedAt
          ? `Trivy ${formatRelative(r.trivy.scannedAt)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      tab: "maintenance",
      label: tx("Maintenance"),
      tone:
        (disk != null && disk >= server.diskThreshold) || backupsBad
          ? "bad"
          : u?.security || u?.rebootRequired || free >= 10e9
            ? "warn"
            : r
              ? "ok"
              : "none",
      text: [
        u
          ? u.security
            ? `${u.security} ${tx("security updates pending")}`
            : tx("up to date")
          : null,
        u?.rebootRequired ? tx("reboot required") : null,
        disk != null ? `${tx("disk")} ${Math.round(disk)}%` : null,
        free >= 1e9 ? `${formatBytes(free)} ${tx("Docker can free")}` : null,
        backupsBad ? `${backupsBad} ${tx("backup checks failing")}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  ];

  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.tab}>
            <button
              type="button"
              onClick={() => onOpen(row.tab)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50"
            >
              <span
                className={`size-2 shrink-0 rounded-full ${TONE_DOT[row.tone]}`}
                aria-hidden
              />
              <span className="w-24 shrink-0 font-medium">{row.label}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {row.text || "—"}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FindingsTab({ serverId }: { serverId: string }) {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [source, setSource] = useState<"all" | FindingSource>("all");
  const [findings, setFindings] = useState<ServerFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFindings(null);
    api
      .getServerFindings(serverId, {
        status,
        source: source === "all" ? undefined : source,
      })
      .then((f) => {
        setFindings(f);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      );
  }, [serverId, status, source]);

  return (
    <Card className="gap-0 overflow-hidden pb-0">
      <CardHeader className="border-b pb-4 [.border-b]:pb-4">
        <CardTitle>{tx("Findings")}</CardTitle>
        <CardDescription>
          {tx(
            "A finding stays open while its source keeps reporting it and resolves itself the first time it no longer does."
          )}
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={status}
            onValueChange={(v) => v && setStatus(v as "open" | "resolved")}
          >
            <ToggleGroupItem value="open">{tx("Open")}</ToggleGroupItem>
            <ToggleGroupItem value="resolved">{tx("Resolved")}</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
        <div className="col-span-full flex flex-wrap gap-1 pt-2">
          {SOURCE_FILTERS.map((s) => (
            <Button
              key={s.value}
              size="sm"
              variant={source === s.value ? "secondary" : "ghost"}
              className="h-7"
              onClick={() => setSource(s.value)}
            >
              {tx(s.label)}
            </Button>
          ))}
        </div>
      </CardHeader>
      {error ? (
        <div className="p-6">
          <ErrorAlert>{error}</ErrorAlert>
        </div>
      ) : !findings ? (
        <div className="space-y-2 p-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : findings.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={
            status === "open" ? tx("Nothing open") : tx("Nothing resolved yet")
          }
          description={
            status === "open"
              ? source === "all"
                ? tx("No open findings.")
                : tx("No open findings from {source}.", {
                    source: SOURCE_LABEL[source],
                  })
              : undefined
          }
          className="py-10"
        />
      ) : (
        <FindingsTable
          findings={findings}
          showSource={source === "all"}
          resolved={status === "resolved"}
        />
      )}
    </Card>
  );
}

function runBadge(run: ServerScanRun) {
  switch (run.status) {
    case "success":
      return <Badge variant="success">done</Badge>;
    case "failed":
      return <Badge variant="destructive-soft">failed</Badge>;
    default:
      return (
        <div className="min-w-40 space-y-1">
          <Badge variant="secondary">
            <Spinner className="size-3" />
            {run.status === "running" && run.progress
              ? `${Math.round(run.progress.percent)}%`
              : run.status === "pending"
                ? "queued"
                : "starting"}
          </Badge>
          {run.progress && <NucleiProgress progress={run.progress} />}
        </div>
      );
  }
}

/**
 * What a running scan is doing — a quarter of an hour of a bare "running"
 * reads like a hang.
 */
function NucleiProgress({
  progress,
}: {
  progress: NonNullable<ServerScanRun["progress"]>;
}) {
  const left =
    progress.rps > 0 && progress.total > progress.requests
      ? Math.ceil((progress.total - progress.requests) / progress.rps / 60)
      : null;
  return (
    <div className="space-y-1">
      <Progress value={progress.percent} className="h-1.5" />
      <p className="text-xs text-muted-foreground">
        {progress.requests.toLocaleString()} / {progress.total.toLocaleString()}{" "}
        {tx("requests ·")} {progress.rps}/s
        {left != null && ` · ${tx("about {n} min left", { n: left })}`}
        {progress.matched > 0 &&
          ` · ${tx("{n} found so far", { n: progress.matched })}`}
      </p>
    </div>
  );
}

function LiveAppsTab({
  server,
  runs,
  onStart,
  starting,
}: {
  server: ServerDetailData;
  runs: ServerScanRun[];
  onStart: () => void;
  starting: boolean;
}) {
  const [appFindings, setAppFindings] = useState<ServerFinding[] | null>(null);
  const busy = runs.some(
    (r) => r.status === "pending" || r.status === "running"
  );
  // Reload the findings when a run finishes.
  const latestRunStatus = runs[0]?.status;

  useEffect(() => {
    api
      .getServerFindings(server.id, { status: "open" })
      .then((f) =>
        setAppFindings(
          f.filter((x) => x.source === "nuclei" || x.source === "kuma")
        )
      )
      .catch(() => setAppFindings([]));
  }, [server.id, latestRunStatus]);

  // Mirrors resolveNucleiTargets on the API: apps, extra URLs, and the
  // server's own address on every port the external check found open.
  const openPorts =
    server.networkState?.ports.filter((p) => p.open).map((p) => p.port) ?? [];
  const addressHost = server.address?.includes(":")
    ? `[${server.address}]`
    : server.address;
  const targets: Array<{
    url: string;
    app: (typeof server.applications)[number] | null;
    label?: string;
  }> = [
    ...server.applications
      .filter((a) => a.liveUrl)
      .map((a) => ({ url: a.liveUrl!, app: a })),
    ...server.nucleiTargets.map((url) => ({ url, app: null })),
    ...(addressHost
      ? (openPorts.length ? openPorts : [80, 443]).map((port) => ({
          url: `${addressHost}:${port}`,
          app: null,
          label: tx("Server address"),
        }))
      : []),
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4" />
            {tx("Live applications")}
          </CardTitle>
          <CardDescription>
            {tx(
              "What the outside world reaches. Nuclei scans these with safe, non-intrusive templates only; findings land on the application they belong to."
            )}
          </CardDescription>
          <CardAction>
            <Button
              size="sm"
              onClick={onStart}
              disabled={starting || busy || targets.length === 0}
            >
              {starting || busy ? <Spinner /> : <Radar />}
              {busy ? tx("Scanning…") : tx("Scan now")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {busy && runs[0]?.progress && (
            <div className="rounded-md border bg-muted/30 p-3">
              <NucleiProgress progress={runs[0].progress} />
            </div>
          )}
          {targets.length === 0 ? (
            <p className="text-muted-foreground">
              {tx(
                "No targets. Link applications that have a live URL in the Settings tab, or add extra URLs there."
              )}
            </p>
          ) : (
            targets.map(({ url, app, label }) => (
              <div
                key={url}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  {app ? (
                    <Link
                      to="/repos/$repoId"
                      params={{ repoId: app.id }}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {app.name}
                    </Link>
                  ) : (
                    <span className="font-medium">
                      {label ?? tx("Extra target")}
                    </span>
                  )}
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {url}
                  </p>
                </div>
                {app?.liveStatus && (
                  <Badge
                    variant={
                      app.liveStatus === "up" ? "success" : "destructive-soft"
                    }
                  >
                    {app.liveStatus === "up" ? tx("online") : tx("offline")}
                  </Badge>
                )}
              </div>
            ))
          )}
          <p className="pt-1 text-xs text-muted-foreground">
            {tx("Schedule:")}{" "}
            {(tx(
              NUCLEI_SCHEDULES.find((s) => s.cron === server.nucleiSchedule)
                ?.label ?? ""
            ) ||
              server.nucleiSchedule) ??
              tx("manual only")}
            {server.nextNucleiAt &&
              ` · ${tx("next {when}", { when: formatRelative(server.nextNucleiAt) ?? "" })}`}
          </p>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="border-b pb-4 [.border-b]:pb-4">
          <CardTitle>{tx("Open findings on the live applications")}</CardTitle>
          <CardDescription>{tx("Nuclei and Uptime Kuma.")}</CardDescription>
        </CardHeader>
        {!appFindings ? (
          <div className="p-6">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : appFindings.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={tx("Nothing found on the live applications")}
            description={
              runs.some((r) => r.status === "success")
                ? tx("The last scan found no issues at low severity or above.")
                : tx("Run a scan to check them.")
            }
            className="py-8"
          />
        ) : (
          <FindingsTable findings={appFindings} />
        )}
      </Card>

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="border-b pb-4 [.border-b]:pb-4">
          <CardTitle>{tx("Nuclei runs")}</CardTitle>
        </CardHeader>
        {runs.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {tx("No runs yet.")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-6">{tx("Started")}</TableHead>
                <TableHead>{tx("Status")}</TableHead>
                <TableHead className="hidden sm:table-cell">
                  {tx("Targets")}
                </TableHead>
                <TableHead className="pr-6 text-right">
                  {tx("Findings")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell
                    className="pl-6 text-xs"
                    title={formatDateTime(run.startedAt) ?? undefined}
                  >
                    {formatRelative(run.startedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {runBadge(run)}
                      {run.errorMessage && (
                        <p className="max-w-sm whitespace-normal text-xs text-destructive">
                          {run.errorMessage}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                    {run.targets.length}
                  </TableCell>
                  <TableCell className="pr-6 text-right tabular">
                    {run.findingCount ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function SettingsTab({
  server,
  onSaved,
}: {
  server: ServerDetailData;
  onSaved: () => void;
}) {
  const [name, setName] = useState(server.name);
  const [targets, setTargets] = useState(server.nucleiTargets.join("\n"));
  const [schedule, setSchedule] = useState(
    NUCLEI_SCHEDULES.find((s) => s.cron === server.nucleiSchedule)?.value ??
      "off"
  );
  const [wazuhAgentId, setWazuhAgentId] = useState(server.wazuhAgentId ?? "");
  const [address, setAddress] = useState(server.address ?? "");
  const [backupChecks, setBackupChecks] = useState<BackupCheck[]>(
    server.backupChecks ?? []
  );
  const [expectedPorts, setExpectedPorts] = useState(
    server.expectedPorts.join(", ")
  );
  const [cpu, setCpu] = useState(String(server.cpuThreshold));
  const [memory, setMemory] = useState(String(server.memoryThreshold));
  const [disk, setDisk] = useState(String(server.diskThreshold));
  const [repos, setRepos] = useState<RepoListItem[] | null>(null);
  const [linked, setLinked] = useState<Set<string>>(
    () => new Set(server.applications.map((a) => a.id))
  );
  const [monitors, setMonitors] = useState<Set<string>>(
    () => new Set(server.kumaMonitors)
  );
  const [kumaList, setKumaList] = useState<string[] | null>(null);
  const [kumaError, setKumaError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRepos()
      .then(setRepos)
      .catch(() => setRepos([]));
  }, []);

  const loadKuma = () => {
    setKumaError(null);
    api
      .getKumaMonitors()
      .then((r) => setKumaList(r.monitors.map((m) => m.name)))
      .catch((e) =>
        setKumaError(
          e instanceof Error ? e.message : tx("Could not load monitors")
        )
      );
  };

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateServer(server.id, {
        name: name.trim(),
        nucleiTargets: targets
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean),
        nucleiSchedule:
          NUCLEI_SCHEDULES.find((s) => s.value === schedule)?.cron ?? null,
        kumaMonitors: [...monitors],
        wazuhAgentId: wazuhAgentId.trim() || null,
        address: address.trim() || null,
        backupChecks,
        expectedPorts: expectedPorts
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map(Number)
          .filter((p) => Number.isInteger(p) && p > 0 && p < 65536),
        cpuThreshold: Number(cpu),
        memoryThreshold: Number(memory),
        diskThreshold: Number(disk),
        repositoryIds: [...linked],
      });
      toast.success(tx("Server settings saved"));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const monitorNames = [...new Set([...(kumaList ?? []), ...monitors])];

  return (
    <div className="max-w-3xl space-y-6">
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <Card>
        <CardHeader>
          <CardTitle>{tx("General")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="srv-name">{tx("Name")}</Label>
            <Input
              id="srv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="srv-address">{tx("Public IP or hostname")}</Label>
              <Input
                id="srv-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="203.0.113.10"
                className="font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="srv-ports">{tx("Expected open ports")}</Label>
              <Input
                id="srv-ports"
                value={expectedPorts}
                onChange={(e) => setExpectedPorts(e.target.value)}
                placeholder="80, 443"
                className="font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {tx(
                "Checked from the outside every 15 minutes, no agent needed: common ports (databases, Docker API, Redis, admin panels…) and the TLS certificate. Any open port not listed as expected is a finding; an expected port that does not answer is too. Open ports are also scanned by Nuclei."
              )}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(
              [
                ["srv-cpu", "CPU alert at %", cpu, setCpu],
                ["srv-mem", "Memory alert at %", memory, setMemory],
                ["srv-disk", "Disk alert at %", disk, setDisk],
              ] as const
            ).map(([id, label, value, set]) => (
              <div key={id} className="grid gap-2">
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={10}
                  max={100}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tx("Applications on this server")}</CardTitle>
          <CardDescription>
            {tx(
              "Their live URLs are scanned by Nuclei and matched to Uptime Kuma monitors, so findings show up on the application itself."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!repos ? (
            <Skeleton className="h-16 w-full" />
          ) : repos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {tx("No repositories in this organization yet.")}
            </p>
          ) : (
            repos.map((repo) => (
              <label
                key={repo.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
              >
                <Checkbox
                  checked={linked.has(repo.id)}
                  onCheckedChange={(v) =>
                    setLinked((s) => toggle(s, repo.id, v === true))
                  }
                />
                <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
                  <span className="truncate font-medium">{repo.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground sm:text-right">
                    {repo.liveUrl ?? tx("no live URL")}
                  </span>
                </span>
              </label>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tx("Backups")}</CardTitle>
          <CardDescription>
            {tx(
              "Where this server's backups land. The agent checks the newest file on every report; one that is too old raises an alarm."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BackupChecksEditor value={backupChecks} onChange={setBackupChecks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tx("Nuclei")}</CardTitle>
          <CardDescription>
            {tx(
              "Extra URLs beyond the applications' live URLs, one per line. The same address rules apply as for live URLs."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            aria-label={tx("Extra Nuclei targets")}
            value={targets}
            onChange={(e) => setTargets(e.target.value)}
            placeholder="https://admin.example.com"
            className="min-h-24 font-mono text-xs"
          />
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="srv-schedule">{tx("Schedule")}</Label>
            <Select value={schedule} onValueChange={setSchedule}>
              <SelectTrigger id="srv-schedule" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NUCLEI_SCHEDULES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {tx(s.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tx("Uptime Kuma & Wazuh")}</CardTitle>
          <CardDescription>
            {tx(
              "Monitors whose URL matches a linked application are attached automatically; pick others here."
            )}
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={loadKuma}>
              <RefreshCw />
              {tx("Load monitors")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {kumaError && <ErrorAlert>{kumaError}</ErrorAlert>}
          {monitorNames.length > 0 && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {monitorNames.map((m) => (
                <label
                  key={m}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={monitors.has(m)}
                    onCheckedChange={(v) =>
                      setMonitors((s) => toggle(s, m, v === true))
                    }
                  />
                  <span className="truncate">{m}</span>
                </label>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="srv-wazuh">{tx("Wazuh agent ID")}</Label>
            <Input
              id="srv-wazuh"
              value={wazuhAgentId}
              onChange={(e) => setWazuhAgentId(e.target.value)}
              placeholder="001"
              className="font-mono"
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving && <Spinner />}
        {saving ? tx("Saving…") : tx("Save settings")}
      </Button>
    </div>
  );
}

function AgentTab({
  server,
  onChanged,
}: {
  server: ServerDetailData;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [fresh, setFresh] = useState<{
    enrollment: Enrollment;
    install: AgentInstall;
  } | null>(null);
  const [confirm, setConfirm] = useState<"revoke" | "delete" | null>(null);

  // Installing with a new code also replaces the agent token, so this is
  // both "set up the agent" and "rotate its credential".
  const generate = async () => {
    setFresh(await api.createEnrollment(server.id));
    onChanged();
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async () => {
    setBusy(true);
    setError(null);
    try {
      if (confirm === "revoke") {
        await api.revokeServerToken(server.id);
        setFresh(null);
        onChanged();
      } else if (confirm === "delete") {
        await api.deleteServer(server.id);
        navigate({ to: "/servers" });
        return;
      }
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Action failed"));
    } finally {
      setBusy(false);
    }
  };

  const copy = {
    revoke: {
      title: "Revoke the agent token?",
      body: "The server can no longer report. Its data stays until you delete the server.",
      action: "Revoke",
    },
    delete: {
      title: `Delete ${server.name}?`,
      body: "Removes the server with all its findings and history. Run `pc-agent.py uninstall` on the server as well.",
      action: "Delete server",
    },
  };

  return (
    <div className="max-w-3xl space-y-6">
      {error && <ErrorAlert>{error}</ErrorAlert>}
      {server.agentOutdated && (
        <Alert variant="warning">
          <RefreshCw />
          <AlertTitle>
            {tx("Agent")} {server.agentVersion} {tx("— version")}{" "}
            {server.latestAgentVersion} {tx("is available")}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {tx(
                "Run this on the server. It replaces only the agent and keeps its token and settings. The agent never updates itself — it accepts no commands from here."
              )}
            </p>
            <CodeLine
              text={(fresh?.install ?? server.install).updateCommand}
              label={tx("agent update command")}
            />
          </AlertDescription>
        </Alert>
      )}
      <HardenStep install={fresh?.install ?? server.install} />
      <AutoUpdateStep install={fresh?.install ?? server.install} />
      <Card>
        <CardHeader>
          <CardTitle>{tx("3. Monitoring agent")}</CardTitle>
          <CardDescription>
            {server.agentTokenSet
              ? tx("Installed — token {prefix}… since {when}", {
                  prefix: server.agentTokenPrefix ?? "",
                  when: formatRelative(server.agentTokenCreatedAt) ?? "",
                })
              : tx("Not installed yet.")}
            {server.agentVersion && ` · agent ${server.agentVersion}`}
            {server.agentTokenSet &&
              tx(
                ". Running the install command again (new code) updates the agent and replaces its token; without a code it keeps the token."
              )}
          </CardDescription>
          <CardAction className="flex gap-2">
            {server.agentTokenSet && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirm("revoke")}
              >
                {tx("Revoke")}
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent>
          <AgentInstallPanel
            install={fresh?.install ?? server.install}
            enrollment={fresh?.enrollment ?? null}
            onGenerate={generate}
          />
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>{tx("Delete server")}</CardTitle>
          <CardDescription>
            {tx("Removes the server, its findings and its history.")}
          </CardDescription>
          <CardAction>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirm("delete")}
            >
              <Trash2 />
              {tx("Delete")}
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => !open && !busy && setConfirm(null)}
      >
        <AlertDialogContent>
          {confirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{copy[confirm].title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {copy[confirm].body}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>
                  {tx("Cancel")}
                </AlertDialogCancel>
                {/* A plain Button: AlertDialogAction would close the dialog
                    before the request has succeeded. */}
                <Button variant="destructive" onClick={act} disabled={busy}>
                  {busy && <Spinner />}
                  {copy[confirm].action}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
      <BuildRunnerStep install={fresh?.install ?? server.install} />
    </div>
  );
}

export function ServerDetail() {
  const { serverId } = useParams({ from: "/servers/$serverId" });
  const [server, setServer] = useState<ServerDetailData | null>(null);
  const [metrics, setMetrics] = useState<ServerMetricPoint[]>([]);
  const [runs, setRuns] = useState<ServerScanRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // The tab lives in the URL, so a finding can link straight to its fix.
  const { tab = "overview" } = useSearch({ from: "/servers/$serverId" });
  const navigate = useNavigate({ from: "/servers/$serverId" });
  const setTab = useCallback(
    (t: TabName) =>
      navigate({
        search: { tab: t === "overview" ? undefined : t },
        replace: true,
      }),
    [navigate]
  );

  const load = useCallback(() => {
    api
      .getServer(serverId)
      .then((s) => {
        setServer(s);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      );
    api
      .getServerMetrics(serverId)
      .then(setMetrics)
      .catch(() => setMetrics([]));
    api
      .getServerScanRuns(serverId)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [serverId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // A Nuclei run takes minutes; follow it more closely while it runs.
  const running = runs.some(
    (r) => r.status === "pending" || r.status === "running"
  );
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      api
        .getServerScanRuns(serverId)
        .then(setRuns)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [running, serverId]);

  const startNuclei = async () => {
    setStarting(true);
    try {
      await api.startNuclei(serverId);
      setRuns(await api.getServerScanRuns(serverId));
      toast.success(tx("Nuclei scan started"));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : tx("Could not start the scan")
      );
    } finally {
      setStarting(false);
    }
  };

  const counts = server?.counts;
  const description = useMemo(() => {
    if (!server) return undefined;
    return [server.hostname, server.os].filter(Boolean).join(" · ") || null;
  }, [server]);

  if (!server) {
    return (
      <div className="space-y-6">
        <PageHeader title={tx("Server")} />
        {error ? (
          <ErrorAlert title={tx("Could not load the server")}>
            {error}
          </ErrorAlert>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[92px] rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={server.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {description}
            <AgentStatusBadge
              status={server.agentStatus}
              lastReportAt={server.lastReportAt}
            />
            {server.agentOutdated && (
              <Badge
                variant="warning"
                className="cursor-pointer"
                onClick={() => setTab("agent")}
                title={tx("A reinstall brings new checks — see the Setup tab")}
              >
                agent {server.agentVersion} → {server.latestAgentVersion}
              </Badge>
            )}
            {counts && counts.total > 0 && (
              <Badge variant={counts.critical ? "destructive" : "outline"}>
                {counts.total === 1
                  ? tx("1 open point")
                  : tx("{n} open points", { n: counts.total })}
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            <MaintenanceButton scope="server" targetId={server.id} />
            <Button variant="outline" size="sm" asChild>
              <Link to="/servers">{tx("All servers")}</Link>
            </Button>
          </>
        }
      />
      {error && <ErrorAlert>{error}</ErrorAlert>}

      {server.agentStatus === "never" && !server.address && tab !== "agent" && (
        <Alert>
          <Activity />
          <AlertTitle>{tx("Waiting for the first report")}</AlertTitle>
          <AlertDescription>
            {tx("Install the agent on the server — the commands are under")}{" "}
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={() => setTab("agent")}
            >
              {tx("Setup")}
            </Button>
            .
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabName)}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">{tx("Overview")}</TabsTrigger>
          <TabsTrigger value="apps">{tx("Apps")}</TabsTrigger>
          <TabsTrigger value="security">{tx("Security")}</TabsTrigger>
          <TabsTrigger value="maintenance">{tx("Maintenance")}</TabsTrigger>
          <TabsTrigger value="findings">
            {tx("Findings")}
            {counts && counts.total > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5">
                {counts.total}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="settings">{tx("Settings")}</TabsTrigger>
          <TabsTrigger value="agent">{tx("Setup")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <OverviewTab server={server} metrics={metrics} onOpen={setTab} />
        </TabsContent>
        <TabsContent value="apps" className="pt-4">
          <AppsTab
            server={server}
            runs={runs}
            onStart={startNuclei}
            starting={starting}
          />
        </TabsContent>
        <TabsContent value="security" className="pt-4">
          <SecurityTab server={server} onReload={load} />
        </TabsContent>
        <TabsContent value="maintenance" className="pt-4">
          <MaintenanceTab server={server} onSaved={load} />
        </TabsContent>
        <TabsContent value="findings" className="pt-4">
          <FindingsTab serverId={server.id} />
        </TabsContent>
        <TabsContent value="settings" className="pt-4">
          <SettingsTab key={server.id} server={server} onSaved={load} />
        </TabsContent>
        <TabsContent value="agent" className="pt-4">
          <AgentTab server={server} onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
