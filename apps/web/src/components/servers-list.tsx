import { useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Plus, Radar, Server, ServerCrash, ShieldAlert } from "lucide-react";
import {
  api,
  type AgentInstall,
  type MissingServer,
  type ServerBase,
  type ServerListItem,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { AgentUpdateAlert } from "@/components/agent-update-alert";
import { DokployMissingAlert } from "@/components/dokploy-missing-alert";
import {
  AgentInstallPanel,
  AgentStatusBadge,
  type Enrollment,
  FindingCountBadges,
  UsageBar,
} from "@/components/server-ui";
import { formatRelative } from "@/lib/schedule";
import { tx } from "@/lib/i18n";

function AddServerDialog({
  open,
  onOpenChange,
  onCreated,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  /** Prefilled, e.g. a Dokploy server without an agent. */
  initial?: { name: string; address: string | null } | null;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  useEffect(() => {
    if (open && initial) {
      setName(initial.name);
      setAddress(initial.address ?? "");
    }
  }, [open, initial]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    server: ServerBase;
    enrollment: Enrollment;
    install: AgentInstall;
  } | null>(null);
  const router = useRouter();

  const close = (next: boolean) => {
    if (!next) {
      setName("");
      setAddress("");
      setError(null);
      setCreated(null);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createServer(name.trim(), address.trim());
      setCreated(res);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : tx("Could not add the server"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {created
              ? tx("Install the agent on {name}", { name: created.server.name })
              : tx("Add server")}
          </DialogTitle>
          <DialogDescription>
            {created
              ? tx(
                  "One command sets up everything. Works on a new server and on one that already runs your apps."
                )
              : tx(
                  "The server reports in through a small agent — this app never gets SSH access or credentials for it."
                )}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <AgentInstallPanel
            install={created.install}
            enrollment={created.enrollment}
            onGenerate={async () => {
              const fresh = await api.createEnrollment(created.server.id);
              setCreated({ ...created, ...fresh });
            }}
          />
        ) : (
          <div className="grid gap-2 py-2">
            <Label htmlFor="server-name">{tx("Name")}</Label>
            <Input
              id="server-name"
              placeholder={tx("e.g. hetzner-web-01")}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <Label htmlFor="server-address" className="mt-2">
              {tx("Public IP or hostname (optional)")}
            </Label>
            <Input
              id="server-address"
              placeholder="203.0.113.10"
              value={address}
              className="font-mono"
              onChange={(e) => setAddress(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {tx(
                "Checked from the outside right away — open ports and TLS, no agent needed. OS version, updates and Trivy need the agent."
              )}
            </p>
            {error && <ErrorAlert>{error}</ErrorAlert>}
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button
              onClick={() => {
                const id = created.server.id;
                close(false);
                router.navigate({
                  to: "/servers/$serverId",
                  params: { serverId: id },
                });
              }}
            >
              {tx("Done — open the server")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                {tx("Cancel")}
              </Button>
              <Button onClick={submit} disabled={submitting || !name.trim()}>
                {submitting ? tx("Adding…") : tx("Add server")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ServersSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </>
  );
}

export function ServersList() {
  const [servers, setServers] = useState<ServerListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<MissingServer | null>(null);

  const load = () => {
    api
      .getServers()
      .then((s) => {
        setServers(s);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      );
  };

  useEffect(() => {
    load();
    // Reports arrive every five minutes; refresh the overview in between so
    // an open tab does not keep showing a server as healthy.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const header = (
    <PageHeader
      title={tx("Servers")}
      description={tx(
        "Load, updates, attacks and vulnerabilities on the machines the applications run on."
      )}
      actions={
        <Button onClick={() => setAddOpen(true)}>
          <Plus />
          {tx("Add server")}
        </Button>
      }
    />
  );

  const dialog = (
    <AddServerDialog
      open={addOpen}
      initial={prefill}
      onOpenChange={(o) => {
        setAddOpen(o);
        if (!o) setPrefill(null);
      }}
      onCreated={load}
    />
  );

  if (!servers) {
    return (
      <div className="space-y-6">
        {header}
        {error ? (
          <ErrorAlert title={tx("Could not load servers")}>{error}</ErrorAlert>
        ) : (
          <ServersSkeleton />
        )}
        {dialog}
      </div>
    );
  }

  const silent = servers.filter((s) => s.agentStatus !== "reporting");
  const critical = servers.reduce((n, s) => n + s.counts.critical, 0);
  const high = servers.reduce((n, s) => n + s.counts.high, 0);
  const securityUpdates = servers.reduce(
    (n, s) => n + (s.lastReport?.updates?.security ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      {header}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <AgentUpdateAlert />
      <DokployMissingAlert
        known={servers.length}
        onAdd={(m) => {
          setPrefill(m);
          setAddOpen(true);
        }}
      />

      {servers.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label={tx("Reporting")}
            value={`${servers.length - silent.length}/${servers.length}`}
            icon={Server}
            tone={silent.length ? "warning" : "success"}
            description={
              silent.length
                ? tx("{n} silent or not yet installed", { n: silent.length })
                : tx("All agents are reporting")
            }
          />
          <StatCard
            label={tx("Critical")}
            value={critical}
            tone="destructive"
          />
          <StatCard label={tx("High")} value={high} tone="destructive" />
          <StatCard
            label={tx("Security updates")}
            value={securityUpdates}
            tone="warning"
            description={tx("pending across all servers")}
          />
        </div>
      )}

      <Card className="gap-0 overflow-hidden py-0">
        {servers.length === 0 ? (
          <EmptyState
            icon={ServerCrash}
            title={tx("No servers yet")}
            description={tx(
              "Add a server and install the agent to see load, pending updates, CrowdSec and Trivy results here."
            )}
            action={
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus />
                {tx("Add server")}
              </Button>
            }
            className="py-12"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-6">{tx("Server")}</TableHead>
                <TableHead className="hidden w-44 @2xl/main:table-cell">
                  {tx("Load")}
                </TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {tx("Updates")}
                </TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {tx("Open findings")}
                </TableHead>
                <TableHead className="hidden pr-6 text-right @2xl/main:table-cell">
                  {tx("Outside check")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((s) => {
                const host = s.lastReport?.host;
                const updates = s.lastReport?.updates;
                const load = (
                  <>
                    <UsageBar
                      label="CPU"
                      value={host?.cpuPct}
                      threshold={s.cpuThreshold}
                    />
                    <UsageBar
                      label={tx("Memory")}
                      value={host?.memoryPct}
                      threshold={s.memoryThreshold}
                    />
                    <UsageBar
                      label={tx("Disk")}
                      value={host?.diskPct}
                      threshold={s.diskThreshold}
                    />
                  </>
                );
                const updateBadges = !updates ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {updates.security > 0 && (
                      <Badge variant="destructive-soft">
                        <ShieldAlert />
                        {tx("{n} security", { n: updates.security })}
                      </Badge>
                    )}
                    {updates.pending - updates.security > 0 && (
                      <Badge variant="secondary">
                        {tx("{n} other", {
                          n: updates.pending - updates.security,
                        })}
                      </Badge>
                    )}
                    {updates.pending === 0 && (
                      <Badge variant="success">{tx("up to date")}</Badge>
                    )}
                    {updates.rebootRequired && (
                      <Badge variant="warning">{tx("restart needed")}</Badge>
                    )}
                  </div>
                );
                const nuclei = s.lastNucleiRun ? (
                  <span className="inline-flex items-center gap-1">
                    <Radar className="size-3" />
                    {s.lastNucleiRun.status === "success"
                      ? formatRelative(s.lastNucleiRun.startedAt)
                      : s.lastNucleiRun.status}
                  </span>
                ) : (
                  tx("never")
                );
                return (
                  <TableRow key={s.id}>
                    <TableCell className="pr-6 pl-6 whitespace-normal @2xl/main:pr-2 @2xl/main:whitespace-nowrap">
                      <div className="space-y-1">
                        <Link
                          to="/servers/$serverId"
                          params={{ serverId: s.id }}
                          className="font-medium break-words hover:text-primary hover:underline @2xl/main:break-normal"
                        >
                          {s.name}
                        </Link>
                        <p className="text-xs break-words text-muted-foreground @2xl/main:break-normal">
                          {[s.address, s.hostname, s.os]
                            .filter(Boolean)
                            .join(" · ") || tx("no report yet")}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          <AgentStatusBadge
                            status={s.agentStatus}
                            lastReportAt={s.lastReportAt}
                          />
                          {s.applications.length > 0 && (
                            <Badge variant="outline">
                              {s.applications.length}{" "}
                              {s.applications.length === 1 ? "app" : "apps"}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* Phones: the other columns, stacked under the name. */}
                      <div className="mt-3 space-y-3 @2xl/main:hidden">
                        <FindingCountBadges counts={s.counts} />
                        {updates && updateBadges}
                        {host && (
                          <div className="grid grid-cols-3 gap-3">{load}</div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {tx("Nuclei:")} {nuclei}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden @2xl/main:table-cell">
                      <div className="w-40 space-y-1.5">{load}</div>
                    </TableCell>
                    <TableCell className="hidden @2xl/main:table-cell">
                      {updateBadges}
                    </TableCell>
                    <TableCell className="hidden @2xl/main:table-cell">
                      <FindingCountBadges counts={s.counts} />
                    </TableCell>
                    <TableCell className="hidden pr-6 text-right text-xs text-muted-foreground @2xl/main:table-cell">
                      {nuclei}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      {dialog}
    </div>
  );
}
