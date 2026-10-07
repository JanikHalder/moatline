import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FolderGit2, Globe, GitBranch, Server } from "lucide-react";
import { api, type DashboardData, type SeverityCounts } from "@/lib/api";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { NextSteps } from "@/components/next-steps";
import { SeverityBadge } from "@/components/severity-badge";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { formatRelative } from "@/lib/schedule";
import { useNarrowContent } from "@/hooks/use-narrow-content";
import { tx } from "@/lib/i18n";

type DashboardRepo = DashboardData["repos"][number];

/**
 * Where a repo's numbers come from. "Live" is the commit the deployment
 * reports, which is what is actually exposed; "branch" is only a stand-in.
 */
function ExposureBadge({ repo }: { repo: DashboardRepo }) {
  if (repo.exposureSource === "live") {
    return (
      <Badge
        variant="outline"
        title={
          repo.liveCommit
            ? tx("Deployed commit {sha}", { sha: repo.liveCommit })
            : undefined
        }
      >
        <Globe />
        {tx("live")}
        {repo.liveCommit && (
          <span className="font-mono opacity-70">
            {repo.liveCommit.slice(0, 7)}
          </span>
        )}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground"
      title={
        repo.liveUrl
          ? tx(
              "The live URL reports no commit, so the deployed version could not be scanned."
            )
          : tx("No live URL — what is deployed is unknown.")
      }
    >
      <GitBranch />
      {tx("branch only")}
    </Badge>
  );
}

/** What Nuclei and Uptime Kuma report about the running application. */
function LiveAppStatus({ repo: r }: { repo: DashboardRepo }) {
  return (
    <>
      {r.liveStatus === "down" ? (
        <Badge variant="destructive">{tx("offline")}</Badge>
      ) : r.appFindings.total > 0 ? (
        <div className="flex flex-wrap gap-1">
          {(["critical", "high", "medium", "low"] as const).map((k) =>
            r.appFindings[k] ? (
              <SeverityBadge key={k} severity={k} count={r.appFindings[k]} />
            ) : null
          )}
        </div>
      ) : r.serverId ? (
        <Badge variant="success">{tx("no findings")}</Badge>
      ) : (
        <span
          className="text-xs text-muted-foreground"
          title={tx(
            "Assign the application to a server to scan its live URL with Nuclei."
          )}
        >
          {tx("not monitored")}
        </span>
      )}
    </>
  );
}

const SEVERITIES: Array<keyof SeverityCounts> = [
  "critical",
  "high",
  "moderate",
  "low",
];

function DashboardSkeleton() {
  return (
    <>
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </>
  );
}

function autoFixLabel(r: DashboardRepo): string {
  return r.autoFixCritical
    ? r.autoDeploy
      ? tx("fix and deploy")
      : tx("on")
    : tx("off");
}

export function Dashboard() {
  const narrow = useNarrowContent();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getDashboard()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : tx("Failed to load"))
      )
      .finally(() => setLoading(false));
  }, []);

  // The heading stays put through loading and failure, so the page never
  // collapses to a bare error line.
  if (loading || error || !data)
    return (
      <div className="space-y-6">
        <PageHeader
          title={tx("Overview")}
          description={tx(
            "What needs you, and how your sites and servers are doing."
          )}
        />
        {loading ? (
          <DashboardSkeleton />
        ) : error ? (
          <ErrorAlert title={tx("Could not load the overview")}>
            {error}
          </ErrorAlert>
        ) : null}
      </div>
    );

  const appFindingTotal = data.repos.reduce(
    (n, r) => n + r.appFindings.total,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={tx("Overview")}
        description={tx(
          "What needs you, and how your sites and servers are doing."
        )}
      />

      <NextSteps data={data} />

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="border-b pb-4 [.border-b]:pb-4">
          <CardTitle>{tx("Sites")}</CardTitle>
          <CardDescription>
            {tx(
              "Known security holes in each site, and whether the live site is healthy."
            )}
          </CardDescription>
          {data.repos.length > 0 && (
            <CardAction>
              <Button asChild variant="outline" size="sm">
                <Link to="/repos">{tx("View all")}</Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        {data.repos.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title={tx("No repositories yet")}
            description={tx("Add one to start scanning.")}
            action={
              <Button asChild size="sm">
                <Link to="/repos">{tx("Go to repositories")}</Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-6">{tx("Application")}</TableHead>
                <TableHead className="pr-6 @2xl/main:pr-2">
                  {tx("Security holes")}
                </TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {tx("Live site")}
                </TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {tx("Auto-fix")}
                </TableHead>
                <TableHead className="hidden pr-6 text-right @2xl/main:table-cell">
                  {tx("Last scan")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.repos.map((r) => (
                <TableRow key={r.repositoryId}>
                  <TableCell className="pl-6 whitespace-normal">
                    <div className="space-y-1">
                      <Link
                        to="/repos/$repoId"
                        params={{ repoId: r.repositoryId }}
                        className="font-medium break-all hover:text-primary hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="flex flex-wrap gap-1">
                        <ExposureBadge repo={r} />
                        {r.fixedNotDeployed > 0 && (
                          <Badge variant="warning">
                            {r.fixedNotDeployed} {tx("fixed, not deployed")}
                          </Badge>
                        )}
                      </div>
                      {narrow && (
                        // The live-app, auto-fix and last-scan columns are
                        // hidden on phones; summarise them here instead.
                        <div className="space-y-1 pt-1 text-xs text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-1">
                            <span>{tx("Live site:")}</span>
                            <LiveAppStatus repo={r} />
                          </div>
                          <p>
                            {tx("Auto-fix")} {autoFixLabel(r)}{" "}
                            {tx("· last scan")}{" "}
                            {r.lastScanAt ? formatRelative(r.lastScanAt) : "—"}
                          </p>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="pr-6 align-top whitespace-normal @2xl/main:pr-2 @2xl/main:align-middle">
                    {!r.scanned ? (
                      <span className="text-xs text-muted-foreground">
                        {tx("not scanned")}
                      </span>
                    ) : r.counts.total === 0 ? (
                      <Badge variant="success">{tx("none known")}</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {SEVERITIES.map((k) => {
                          const n = r.counts[k];
                          if (!n) return null;
                          return (
                            <SeverityBadge key={k} severity={k} count={n} />
                          );
                        })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden @2xl/main:table-cell">
                    <LiveAppStatus repo={r} />
                  </TableCell>
                  <TableCell className="hidden @2xl/main:table-cell">
                    {r.autoFixCritical ? (
                      <Badge variant="secondary">{autoFixLabel(r)}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {autoFixLabel(r)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className="hidden pr-6 text-right text-xs text-muted-foreground @2xl/main:table-cell"
                    title={
                      r.lastScanAt
                        ? new Date(r.lastScanAt).toLocaleString()
                        : undefined
                    }
                  >
                    {r.lastScanAt ? formatRelative(r.lastScanAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ServersSummary data={data} appFindingTotal={appFindingTotal} />
    </div>
  );
}

function ServersSummary({
  data,
  appFindingTotal,
}: {
  data: DashboardData;
  appFindingTotal: number;
}) {
  const s = data.servers;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="size-4" />
          {tx("Servers")}
        </CardTitle>
        <CardDescription>
          {s.total === 0
            ? tx(
                "No servers connected — load, updates, CrowdSec and Trivy on the hosts are not monitored."
              )
            : [
                tx("{n} of {total} reporting", {
                  n: s.reporting,
                  total: s.total,
                }),
                s.stale ? tx("{n} silent", { n: s.stale }) : null,
                s.never
                  ? tx("{n} waiting for the agent", { n: s.never })
                  : null,
                appFindingTotal
                  ? tx("{n} findings on live sites", { n: appFindingTotal })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link to="/servers">
              {s.total === 0 ? tx("Add server") : tx("View all")}
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      {s.total > 0 && (
        <div className="flex flex-wrap gap-1 px-6">
          {s.findings.total === 0 ? (
            <Badge variant="success">{tx("no open findings")}</Badge>
          ) : (
            (["critical", "high", "medium", "low"] as const).map((k) =>
              s.findings[k] ? (
                <SeverityBadge key={k} severity={k} count={s.findings[k]} />
              ) : null
            )
          )}
        </div>
      )}
    </Card>
  );
}
