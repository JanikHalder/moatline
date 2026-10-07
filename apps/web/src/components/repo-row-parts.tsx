import { Link } from "@tanstack/react-router";
import { hostLabel, pullsUrl } from "@/lib/git-host";
import { toast } from "sonner";
import {
  ExternalLink,
  FileText,
  GitBranch,
  GitPullRequest,
  Globe,
  MoreHorizontal,
  PackageSearch,
  RefreshCw,
  Rocket,
  Settings,
  ShieldAlert,
  Undo2,
  Zap,
} from "lucide-react";
import { api, type RepoListItem } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, formatRelative } from "@/lib/schedule";
import { copyFindings } from "@/lib/findings-export";
import { useT } from "@/lib/i18n";
import {
  deployPlatform,
  hasDeployTarget,
  openInPlatform,
} from "@/lib/platform";

export type RepoAction = "fast-scan" | "scan" | "fix" | "update" | "deploy";

/** CVEs of the latest scan, worst first; "none" is good news worth showing. */
export function VulnSummary({ repo }: { repo: RepoListItem }) {
  const t = useT();
  const site = (repo.siteProbe?.findings ?? []).filter(
    (f) => f.severity === "critical" || f.severity === "high"
  ).length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <PackageVulns repo={repo} />
      {site > 0 && (
        <Badge
          variant="destructive-soft"
          title={t("Live site exposes something")}
        >
          {t(site === 1 ? "{n} site issue" : "{n} site issues", { n: site })}
        </Badge>
      )}
    </div>
  );
}

function PackageVulns({ repo }: { repo: RepoListItem }) {
  const t = useT();
  const v = repo.vulns;
  if (!v) return <span className="text-xs text-muted-foreground">—</span>;
  const total = v.critical + v.high + v.moderate + v.low;
  if (total === 0) return <Badge variant="success">{t("none known")}</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {v.critical > 0 && (
        <Badge variant="destructive">
          {t("{n} critical", { n: v.critical })}
        </Badge>
      )}
      {v.high > 0 && (
        <Badge variant="destructive-soft">{t("{n} high", { n: v.high })}</Badge>
      )}
      {v.moderate > 0 && (
        <Badge variant="warning">{t("{n} moderate", { n: v.moderate })}</Badge>
      )}
      {v.low > 0 && (
        <Badge variant="outline">{t("{n} low", { n: v.low })}</Badge>
      )}
      {v.fixable > 0 && (
        <span className="text-xs text-muted-foreground">
          {t("{n} fixable", { n: v.fixable })}
        </span>
      )}
    </div>
  );
}

/** The latest mobile Lighthouse score, coloured like Lighthouse does. */
export function PerfBadge({ repo }: { repo: RepoListItem }) {
  const t = useT();
  const p = repo.perf;
  if (!p || p.performance == null) return null;
  const variant =
    p.performance >= 90
      ? "success"
      : p.performance >= 50
        ? "warning"
        : "destructive-soft";
  return (
    <Badge
      variant={variant}
      title={
        t("Mobile Lighthouse") +
        (p.failures
          ? ` · ${t("misses {n} budget items", { n: p.failures })}`
          : "")
      }
    >
      perf {p.performance}
      {p.failures > 0 && <span className="opacity-70">· {p.failures}✗</span>}
    </Badge>
  );
}

export function OutdatedSummary({ repo }: { repo: RepoListItem }) {
  const t = useT();
  const o = repo.outdated;
  if (!o) return <span className="text-xs text-muted-foreground">—</span>;
  if (o.total === 0) return <Badge variant="success">{t("up to date")}</Badge>;
  return (
    <span className="text-sm tabular-nums">
      {t("{n} outdated", { n: o.total })}
      {o.major > 0 && (
        <span className="block text-xs text-muted-foreground">
          {t("{n} major", { n: o.major })}
        </span>
      )}
    </span>
  );
}

/** Last deploy and what the guard made of it, plus an open PR if any. */
export function DeploySummary({ repo }: { repo: RepoListItem }) {
  const t = useT();
  const d = repo.lastDeploy;
  const run = repo.openRun;
  return (
    <div className="flex flex-col items-start gap-1">
      {d ? (
        <span
          className="flex items-center gap-1.5 text-xs"
          title={formatDateTime(d.triggeredAt) ?? undefined}
        >
          <Rocket className="size-3.5 text-muted-foreground" />
          {d.status === "failed" ? (
            <span className="text-destructive">{t("rejected")}</span>
          ) : d.guard === "rolled_back" ? (
            <span className="text-warning">{t("rolled back")}</span>
          ) : d.guard === "error_spike" ? (
            <span className="text-destructive">{t("errors jumped")}</span>
          ) : d.guard === "broken" ||
            d.guard === "build_failed" ||
            d.guard === "rollback_failed" ||
            d.liveOk === false ? (
            <span className="text-destructive">{t("not live")}</span>
          ) : d.liveOk ? (
            <span className="text-success">{t("live")}</span>
          ) : (
            <span>{t("deployed")}</span>
          )}
          <span className="text-muted-foreground">
            {formatRelative(d.triggeredAt)}
          </span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t("no deploy yet")}
        </span>
      )}
      {(() => {
        // PRs on the host that are not this run's own (people, Dependabot,
        // older Moatline runs).
        const others = (repo.openPrs ?? []).filter(
          (p) => !run?.prUrl || p.url !== run.prUrl
        );
        if (!others.length) return null;
        return (
          <a
            href={pullsUrl(repo.githubUrl, repo.gitHost)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:underline"
            title={others.map((p) => `#${p.number} ${p.title}`).join("\n")}
          >
            <GitPullRequest className="size-3.5" />
            {t(
              others.length === 1
                ? "{n} open PR on {host}"
                : "{n} open PRs on {host}",
              {
                n: others.length,
                host: hostLabel(repo.githubUrl, repo.gitHost),
              }
            )}
          </a>
        );
      })()}
      {run && (
        <span className="flex items-center gap-1.5 text-xs">
          <GitPullRequest className="size-3.5 text-muted-foreground" />
          {run.prUrl ? (
            <a
              href={run.prUrl}
              target="_blank"
              rel="noreferrer"
              className={
                run.buildOk === false
                  ? "text-warning hover:underline"
                  : "text-primary hover:underline"
              }
            >
              {run.kind === "security" ? t("fix PR") : t("update PR")}
              {run.buildOk === false
                ? ` · ${t("check failed")}`
                : ` ${t("open")}`}
            </a>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Spinner className="size-3" />
              {run.kind === "security" ? t("fixing…") : t("updating…")}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** Everything one might do with a repository, without opening it. */
export function RowActions({
  repo,
  busy,
  onAction,
}: {
  repo: RepoListItem;
  busy: RepoAction | null;
  onAction: (action: RepoAction) => void;
}) {
  const scanning =
    repo.lastScanStatus === "pending" || repo.lastScanStatus === "running";
  const fixable = (repo.vulns?.fixable ?? 0) > 0;
  const t = useT();
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onAction("fast-scan")}
        disabled={!!busy || scanning}
        title={t("Lockfile + advisory database — about a second")}
      >
        {busy === "fast-scan" ? <Spinner /> : <Zap />}
        {t("Scan")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("More actions for {name}", { name: repo.name })}
            disabled={!!busy}
          >
            {busy && busy !== "fast-scan" ? <Spinner /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate">
            {repo.name}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={scanning}
            onSelect={() => onAction("scan")}
          >
            <RefreshCw />
            {t("Full scan (unused packages too)")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!fixable || !!repo.openRun}
            onSelect={() => onAction("fix")}
          >
            <ShieldAlert />
            {t("Fix CVEs")}
            {fixable ? ` (${repo.vulns!.fixable})` : ""}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!!repo.openRun}
            onSelect={() => onAction("update")}
          >
            <PackageSearch />
            {t("Update packages (minor & patch)")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasDeployTarget(repo)}
            onSelect={() => onAction("deploy")}
          >
            <Rocket />
            {t("Deploy with {platform}", {
              platform: deployPlatform(repo) ?? "Dokploy",
            })}
          </DropdownMenuItem>
          {hasDeployTarget(repo) && (
            <DropdownMenuItem
              onSelect={() =>
                openInPlatform(repo.id, api.getPlatformLink, (m) =>
                  toast.error(m)
                )
              }
            >
              <ExternalLink />
              {t("Open in {platform}", { platform: deployPlatform(repo)! })}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => copyFindings(repo.id)}>
            <FileText />
            {t("Copy findings for agent")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {repo.openRun?.prUrl && (
            <DropdownMenuItem asChild>
              <a href={repo.openRun.prUrl} target="_blank" rel="noreferrer">
                <GitPullRequest />
                {t("Open pull request")}
              </a>
            </DropdownMenuItem>
          )}
          {repo.liveUrl && (
            <DropdownMenuItem asChild>
              <a
                href={(() => {
                  try {
                    return new URL(repo.liveUrl).origin;
                  } catch {
                    return repo.liveUrl;
                  }
                })()}
                target="_blank"
                rel="noreferrer"
              >
                <Globe />
                {t("Open live site")}
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href={repo.githubUrl} target="_blank" rel="noreferrer">
              <GitBranch />
              {t("Open on {host}", {
                host: hostLabel(repo.githubUrl, repo.gitHost),
              })}
              <ExternalLink className="ml-auto" />
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/repos/$repoId" params={{ repoId: repo.id }}>
              <Settings />
              {t("Details & settings")}
            </Link>
          </DropdownMenuItem>
          {repo.lastDeploy &&
            (repo.lastDeploy.guard === "broken" ||
              repo.lastDeploy.guard === "build_failed") && (
              <DropdownMenuItem asChild>
                <Link to="/repos/$repoId" params={{ repoId: repo.id }}>
                  <Undo2 />
                  {t("Roll back…")}
                </Link>
              </DropdownMenuItem>
            )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
