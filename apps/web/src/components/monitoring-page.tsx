import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type FindingSource,
  type OrgFinding,
  type ServerListItem,
  type UptimeMonitor,
  type UptimeOverview,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageHeader } from "@/components/page-header";
import { StatBand, StatCard } from "@/components/stat-card";
import { CronChecksTab, PlatformsTab } from "@/components/monitoring-jobs";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { FindingsTable } from "@/components/server-ui";
import { formatDateTime, formatRelative } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { tx } from "@/lib/i18n";

const UNASSIGNED = "none";
/** Certificates expiring within this many days are flagged. */
const CERT_WARN_DAYS = 21;

function MonitorStatusBadge({ m }: { m: UptimeMonitor }) {
  switch (m.statusLabel) {
    case "up":
      return <Badge variant="success">up</Badge>;
    case "down":
      return <Badge variant="destructive">down</Badge>;
    case "pending":
      return <Badge variant="warning">retrying</Badge>;
    case "maintenance":
      return <Badge variant="secondary">maintenance</Badge>;
    default:
      return <Badge variant="outline">unknown</Badge>;
  }
}

function CertCell({ m }: { m: UptimeMonitor }) {
  if (m.certValid === false) {
    return <Badge variant="destructive-soft">invalid</Badge>;
  }
  if (m.certDaysRemaining == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const days = Math.floor(m.certDaysRemaining);
  if (days <= 7) return <Badge variant="destructive-soft">{days} days</Badge>;
  if (days <= CERT_WARN_DAYS)
    return <Badge variant="warning">{days} days</Badge>;
  return (
    <span className="tabular text-xs text-muted-foreground">{days} days</span>
  );
}

function hasProblem(m: UptimeMonitor): boolean {
  return (
    m.status === 0 ||
    m.status === 2 ||
    m.certValid === false ||
    (m.certDaysRemaining != null && m.certDaysRemaining <= CERT_WARN_DAYS)
  );
}

const STATUS_ORDER: Record<string, number> = {
  down: 0,
  pending: 1,
  maintenance: 2,
  up: 3,
};

function UptimeTab() {
  const [data, setData] = useState<UptimeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "problems" | "unassigned">(
    "all"
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    const load = () =>
      api
        .getUptime()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(e instanceof Error ? e.message : tx("Failed to load"))
        );
    load();
    // The scheduler pulls Kuma every five minutes; follow along.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setData(await api.refreshUptime());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Refresh failed"));
    } finally {
      setRefreshing(false);
    }
  };

  const assign = async (monitor: string, serverId: string | null) => {
    setAssigning(monitor);
    try {
      setData(await api.assignMonitor(monitor, serverId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx("Could not assign"));
    } finally {
      setAssigning(null);
    }
  };

  const monitors = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.monitors
      .filter((m) =>
        filter === "problems"
          ? hasProblem(m)
          : filter === "unassigned"
            ? !m.serverId
            : true
      )
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          (m.url ?? m.hostname ?? "").toLowerCase().includes(q)
      )
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.statusLabel ?? ""] ?? 4) -
            (STATUS_ORDER[b.statusLabel ?? ""] ?? 4) ||
          a.name.localeCompare(b.name)
      );
  }, [data, filter, query]);

  if (error)
    return (
      <ErrorAlert title={tx("Could not load monitors")}>{error}</ErrorAlert>
    );
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[92px] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (!data.configured) {
    return (
      <Card>
        <EmptyState
          icon={Activity}
          title={tx("Uptime Kuma is not connected")}
          description={tx(
            "Enter the Kuma URL and an API key under Settings to see all monitors here."
          )}
          action={
            <Button asChild size="sm">
              <Link to="/settings">{tx("Open settings")}</Link>
            </Button>
          }
          className="py-12"
        />
      </Card>
    );
  }

  // Phones show it under the monitor name, tablets and up in its own column.
  const serverPicker = (m: UptimeMonitor, width: string) => (
    <div className="flex flex-wrap items-center gap-2 @2xl/main:flex-nowrap">
      <Select
        value={m.serverId ?? UNASSIGNED}
        onValueChange={(v) => assign(m.name, v === UNASSIGNED ? null : v)}
        disabled={assigning === m.name || data.servers.length === 0}
      >
        <SelectTrigger
          size="sm"
          className={width}
          aria-label={tx("Server for {name}", { name: m.name })}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>{tx("Not assigned")}</SelectItem>
          {data.servers.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {assigning === m.name && <Spinner />}
      {m.repositoryId && (
        <Link
          to="/repos/$repoId"
          params={{ repoId: m.repositoryId }}
          className="max-w-full truncate text-xs text-primary hover:underline"
        >
          {m.repositoryName}
        </Link>
      )}
    </div>
  );

  const all = data.monitors;
  const down = all.filter((m) => m.status === 0).length;
  const retrying = all.filter((m) => m.status === 2).length;
  const certs = all.filter(
    (m) =>
      m.certValid === false ||
      (m.certDaysRemaining != null && m.certDaysRemaining <= CERT_WARN_DAYS)
  ).length;
  const unassigned = all.filter((m) => !m.serverId).length;

  return (
    <div className="space-y-6">
      {data.error && (
        <ErrorAlert title={tx("Uptime Kuma could not be reached")}>
          {data.error} {tx("— showing the state from")}{" "}
          {formatDateTime(data.checkedAt) ?? tx("the last successful pull")}.
        </ErrorAlert>
      )}

      <StatBand>
        <StatCard
          label={tx("Up")}
          value={`${all.length - down - retrying}/${all.length}`}
          tone={down ? "destructive" : "success"}
          description={
            data.checkedAt
              ? tx("checked {when}", {
                  when: formatRelative(data.checkedAt) ?? "",
                })
              : undefined
          }
        />
        <StatCard label={tx("Down")} value={down} tone="destructive" />
        <StatCard
          label={tx("Retrying")}
          value={retrying}
          tone="warning"
          description={tx("failed a check, not down yet")}
        />
        <StatCard
          label={tx("Certificates")}
          value={certs}
          tone="warning"
          description={tx("invalid or expiring within {n} days", {
            n: CERT_WARN_DAYS,
          })}
        />
      </StatBand>

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="border-b pb-4 [.border-b]:pb-4">
          <CardTitle>{tx("Monitors")}</CardTitle>
          <CardDescription>
            {tx(
              "Assign a monitor to a server and its problems appear there and in Findings. Monitors on an application's live URL are assigned automatically."
            )}
            {unassigned > 0 &&
              ` ${tx("{n} not assigned yet.", { n: unassigned })}`}
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            {data.baseUrl && (
              <Button asChild variant="ghost" size="sm">
                <a
                  href={data.baseUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {tx("Open Kuma")}
                  <ExternalLink />
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing}
            >
              {refreshing ? <Spinner /> : <RefreshCw />}
              {tx("Refresh")}
            </Button>
          </CardAction>
          <div className="col-span-full flex flex-wrap items-center gap-2 pt-2">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={tx("Search monitors")}
                placeholder={tx("Search name or URL")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pl-8"
              />
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={filter}
              onValueChange={(v) => v && setFilter(v as typeof filter)}
            >
              <ToggleGroupItem value="all">{tx("All")}</ToggleGroupItem>
              <ToggleGroupItem value="problems">
                {tx("Problems")}
              </ToggleGroupItem>
              <ToggleGroupItem value="unassigned">
                {tx("Unassigned")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardHeader>
        {monitors.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={
              filter === "problems"
                ? tx("No problems")
                : tx("No monitors match")
            }
            className="py-10"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-24 pl-6">{tx("Status")}</TableHead>
                <TableHead>{tx("Monitor")}</TableHead>
                <TableHead className="hidden w-24 text-right @2xl/main:table-cell">
                  {tx("Response")}
                </TableHead>
                <TableHead className="hidden w-28 @2xl/main:table-cell">
                  <span className="inline-flex items-center gap-1">
                    <LockKeyhole className="size-3" />
                    TLS
                  </span>
                </TableHead>
                <TableHead className="hidden w-72 pr-6 @2xl/main:table-cell">
                  {tx("Server · application")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monitors.map((m) => (
                <TableRow key={m.name}>
                  <TableCell className="pl-6">
                    <MonitorStatusBadge m={m} />
                  </TableCell>
                  <TableCell className="max-w-sm pr-6 whitespace-normal @2xl/main:pr-2">
                    <p className="font-medium break-words @2xl/main:truncate">
                      {m.name}
                    </p>
                    {(m.url ?? m.hostname) && (
                      <p className="font-mono text-xs break-all text-muted-foreground @2xl/main:truncate">
                        {m.url ?? m.hostname}
                      </p>
                    )}
                    <div className="mt-2 space-y-2 @2xl/main:hidden">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="tabular">
                          {m.responseTimeMs != null
                            ? `${m.responseTimeMs} ms`
                            : "—"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <LockKeyhole className="size-3" />
                          <CertCell m={m} />
                        </span>
                      </div>
                      {serverPicker(m, "w-full")}
                    </div>
                  </TableCell>
                  <TableCell className="tabular hidden text-right text-xs text-muted-foreground @2xl/main:table-cell">
                    {m.responseTimeMs != null ? `${m.responseTimeMs} ms` : "—"}
                  </TableCell>
                  <TableCell className="hidden @2xl/main:table-cell">
                    <CertCell m={m} />
                  </TableCell>
                  <TableCell className="hidden pr-6 @2xl/main:table-cell">
                    {serverPicker(m, "w-48")}
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

const SOURCE_FILTERS: Array<{ value: "all" | FindingSource; label: string }> = [
  { value: "all", label: "All" },
  { value: "kuma", label: "Uptime Kuma" },
  { value: "trivy", label: "Trivy" },
  { value: "crowdsec", label: "CrowdSec" },
  { value: "nuclei", label: "Nuclei" },
  { value: "wazuh", label: "Wazuh" },
  { value: "security", label: "Security" },
  { value: "network", label: "External check" },
  { value: "provider", label: "Hetzner firewall" },
  { value: "dokploy", label: "Dokploy" },
  { value: "registry", label: "Docker Hub" },
  { value: "coolify", label: "Coolify" },
  { value: "platform", label: "Platforms" },
  { value: "host", label: "Host" },
  { value: "heartbeat", label: "Agent" },
];

function FindingsTab() {
  const [source, setSource] = useState<"all" | FindingSource>("all");
  const [findings, setFindings] = useState<OrgFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFindings(null);
    api
      .getOrgFindings(source === "all" ? undefined : source)
      .then((f) => {
        setFindings(f);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      );
  }, [source]);

  return (
    <Card className="gap-0 overflow-hidden pb-0">
      <CardHeader className="border-b pb-4 [.border-b]:pb-4">
        <CardTitle>{tx("Open findings on all servers")}</CardTitle>
        <CardDescription>
          {tx(
            "Every tool in one list, most severe first. Click a row for details."
          )}
        </CardDescription>
        <div className="col-span-full flex flex-wrap gap-1 pt-2">
          {SOURCE_FILTERS.map((s) => (
            <Button
              key={s.value}
              size="sm"
              variant={source === s.value ? "secondary" : "ghost"}
              className="h-7"
              onClick={() => setSource(s.value)}
            >
              {s.label}
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
          title={tx("Nothing open")}
          description={tx("No tool reports a problem right now.")}
          className="py-10"
        />
      ) : (
        <FindingsTable
          findings={findings}
          showSource={source === "all"}
          showServer
        />
      )}
    </Card>
  );
}

type CellState = {
  tone: "ok" | "warn" | "bad" | "off";
  label: string;
  hint?: string;
};

const TONE_VARIANT = {
  ok: "success",
  warn: "warning",
  bad: "destructive-soft",
  off: "outline",
} as const;

function Cell({ state }: { state: CellState }) {
  const badge = <Badge variant={TONE_VARIANT[state.tone]}>{state.label}</Badge>;
  if (!state.hint) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default">{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{state.hint}</TooltipContent>
    </Tooltip>
  );
}

const DAY = 24 * 60 * 60 * 1000;

/** What each tool says about one server — or that it says nothing. */
function coverage(s: ServerListItem): Record<string, CellState> {
  const r = s.lastReport;
  const agent: CellState =
    s.agentStatus === "reporting" && s.agentOutdated
      ? {
          tone: "warn",
          label: `update ${s.agentVersion} → ${s.latestAgentVersion}`,
          hint: "Reinstall from the server's Setup tab to get the new checks.",
        }
      : s.agentStatus === "reporting"
        ? {
            tone: "ok",
            label: "reporting",
            hint: `Last report ${formatDateTime(s.lastReportAt)}`,
          }
        : s.agentStatus === "stale"
          ? {
              tone: "bad",
              label: "silent",
              hint: `Last report ${formatDateTime(s.lastReportAt)}`,
            }
          : { tone: "bad", label: "not installed" };

  const t = r?.trivy;
  const trivy: CellState = !t
    ? { tone: "off", label: "no scan yet" }
    : !t.available
      ? { tone: "bad", label: "missing", hint: t.error ?? undefined }
      : Date.now() - new Date(t.scannedAt).getTime() > 2 * DAY
        ? {
            tone: "warn",
            label: "stale",
            hint: `Last scan ${formatDateTime(t.scannedAt)}`,
          }
        : {
            tone: t.total > 0 ? "warn" : "ok",
            label: t.total > 0 ? `${t.total} CVEs` : "clean",
            hint: `Scanned ${formatRelative(t.scannedAt)}`,
          };

  const cs = r?.crowdsec;
  const crowdsec: CellState = !cs
    ? { tone: "off", label: "—" }
    : !cs.available
      ? { tone: "bad", label: "missing", hint: cs.error ?? undefined }
      : cs.bouncers.length === 0
        ? {
            tone: "bad",
            label: "no bouncer",
            hint: "Detects, but blocks nothing.",
          }
        : {
            tone: "ok",
            label: `${cs.alerts24h ?? 0} alerts`,
            hint: `${cs.activeDecisions ?? 0} active bans · ${cs.bouncers.length} bouncer(s)`,
          };

  const u = r?.updates;
  const ua = u?.unattended;
  const lastRun = ua?.lastRunAt ? new Date(ua.lastRunAt).getTime() : NaN;
  const updates: CellState = !u
    ? { tone: "off", label: "—" }
    : u.autoUpdates === false
      ? {
          tone: "bad",
          label: "off",
          hint: "Security updates only arrive by hand.",
        }
      : !ua
        ? {
            tone: "off",
            label: "unknown",
            hint: "Agent older than 1.2.0 – reinstall it to report this.",
          }
        : ua.lastResult === "error"
          ? { tone: "bad", label: "failed", hint: ua.lastError ?? undefined }
          : !Number.isFinite(lastRun) || Date.now() - lastRun > 2 * DAY
            ? {
                tone: "bad",
                label: "silent",
                hint: ua.lastRunAt
                  ? `Last run ${formatDateTime(ua.lastRunAt)}`
                  : "Never ran",
              }
            : u.rebootRequired && !ua.rebootScheduledAt
              ? { tone: "warn", label: "reboot pending" }
              : {
                  tone: "ok",
                  label: u.security ? `ok · ${u.security} due` : "ok",
                  hint: `Last run ${formatRelative(ua.lastRunAt)}${ua.nextRunAt ? ` · next ${formatRelative(ua.nextRunAt)}` : ""}`,
                };

  const run = s.lastNucleiRun;
  const nuclei: CellState = !run
    ? { tone: "off", label: "never" }
    : run.status === "failed"
      ? { tone: "bad", label: "failed" }
      : run.status !== "success"
        ? { tone: "off", label: run.status }
        : {
            tone: run.findingCount ? "warn" : "ok",
            label: run.findingCount ? `${run.findingCount} found` : "clean",
            hint: `Scanned ${formatRelative(run.startedAt)}`,
          };

  const mons = s.kumaState?.monitors ?? [];
  const downCount = mons.filter((m) => m.status === 0).length;
  const kuma: CellState = s.kumaState?.error
    ? { tone: "warn", label: "unreachable", hint: s.kumaState.error }
    : mons.length === 0
      ? { tone: "off", label: "none" }
      : downCount
        ? { tone: "bad", label: `${downCount} down` }
        : { tone: "ok", label: `${mons.length} up` };

  const w = s.wazuhState;
  const wazuh: CellState = !s.wazuhAgentId
    ? { tone: "off", label: "off" }
    : w?.error
      ? { tone: "warn", label: "error", hint: w.error }
      : !w?.agent
        ? { tone: "off", label: "pending" }
        : w.agent.status === "active"
          ? { tone: "ok", label: "active" }
          : { tone: "bad", label: w.agent.status ?? "unknown" };

  const n = s.networkState;
  const unexpected = n?.ports.filter((p) => p.open && !p.expected).length ?? 0;
  const missing = n?.ports.filter((p) => !p.open && p.expected).length ?? 0;
  const external: CellState = !s.address
    ? { tone: "off", label: "no address" }
    : !n
      ? { tone: "off", label: "pending" }
      : n.error
        ? { tone: "warn", label: "error", hint: n.error }
        : n.ports.every((p) => !p.open)
          ? { tone: "bad", label: "unreachable" }
          : unexpected || missing
            ? {
                tone: "bad",
                label: `${unexpected + missing} port issue${unexpected + missing === 1 ? "" : "s"}`,
                hint: `Checked ${formatRelative(n.checkedAt)}`,
              }
            : {
                tone: "ok",
                label: "as expected",
                hint: `Checked ${formatRelative(n.checkedAt)}`,
              };

  return { agent, updates, external, trivy, crowdsec, nuclei, kuma, wazuh };
}

const COVERAGE_COLUMNS: Array<[string, ReactNode]> = [
  ["agent", "Agent"],
  ["updates", "Auto-updates"],
  ["external", "External"],
  ["trivy", "Trivy"],
  ["crowdsec", "CrowdSec"],
  ["nuclei", "Nuclei"],
  ["kuma", "Uptime Kuma"],
  ["wazuh", "Wazuh"],
];

/**
 * The matrix is wider than a phone or tablet: it scrolls sideways there, with
 * the server name pinned so every row stays readable.
 */
const COVERAGE_STICKY =
  "pl-6 max-lg:sticky max-lg:left-0 max-lg:z-10 max-lg:shadow-[inset_-1px_0_0_var(--border)]";
const COVERAGE_STICKY_HEAD = cn(
  COVERAGE_STICKY,
  "max-lg:bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]"
);
const COVERAGE_STICKY_CELL = cn(
  COVERAGE_STICKY,
  "max-lg:max-w-36 max-lg:truncate max-lg:bg-card"
);

function CoverageTab() {
  const [servers, setServers] = useState<ServerListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getServers()
      .then(setServers)
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      );
  }, []);

  if (error) return <ErrorAlert>{error}</ErrorAlert>;
  if (!servers) return <Skeleton className="h-64 rounded-lg" />;

  return (
    <Card className="gap-0 overflow-hidden pb-0">
      <CardHeader className="border-b pb-4 [.border-b]:pb-4">
        <CardTitle>{tx("Coverage")}</CardTitle>
        <CardDescription>
          {tx(
            'Which tool watches which server. A grey cell is not "all good" — it means nobody is looking.'
          )}
          <span className="lg:hidden">
            {" "}
            {tx("Scroll sideways for every tool.")}
          </span>
        </CardDescription>
      </CardHeader>
      {servers.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={tx("No servers yet")}
          action={
            <Button asChild size="sm">
              <Link to="/servers">{tx("Add server")}</Link>
            </Button>
          }
          className="py-10"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className={COVERAGE_STICKY_HEAD}>
                {tx("Server")}
              </TableHead>
              {COVERAGE_COLUMNS.map(([key, label]) => (
                <TableHead key={key}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {servers.map((s) => {
              const c = coverage(s);
              return (
                <TableRow key={s.id}>
                  <TableCell className={COVERAGE_STICKY_CELL}>
                    <Link
                      to="/servers/$serverId"
                      params={{ serverId: s.id }}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {s.name}
                    </Link>
                  </TableCell>
                  {COVERAGE_COLUMNS.map(([key]) => (
                    <TableCell key={key}>
                      <Cell state={c[key]!} />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function MonitoringPage() {
  const [tab, setTab] = useState("uptime");
  return (
    <div className="space-y-6">
      <PageHeader
        title={tx("Monitoring")}
        description={tx(
          "Uptime Kuma, Trivy, CrowdSec, Nuclei, Wazuh and the server agents in one place."
        )}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="uptime">{tx("Uptime")}</TabsTrigger>
          <TabsTrigger value="findings">{tx("Findings")}</TabsTrigger>
          <TabsTrigger value="coverage">{tx("Coverage")}</TabsTrigger>
          <TabsTrigger value="jobs">{tx("Jobs")}</TabsTrigger>
          <TabsTrigger value="platforms">{tx("Platforms")}</TabsTrigger>
        </TabsList>
        <TabsContent value="uptime" className="pt-4">
          <UptimeTab />
        </TabsContent>
        <TabsContent value="findings" className="pt-4">
          <FindingsTab />
        </TabsContent>
        <TabsContent value="coverage" className="pt-4">
          <CoverageTab />
        </TabsContent>
        <TabsContent value="jobs" className="pt-4">
          <CronChecksTab />
        </TabsContent>
        <TabsContent value="platforms" className="pt-4">
          <PlatformsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
