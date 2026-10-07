import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Rocket,
  FolderGit2,
  Globe,
  Plus,
  Search,
  Timer,
  Zap,
  ChevronDown,
  CalendarClock,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  api,
  type GithubRepo,
  type RepoListItem,
  type SchedulerStatus,
} from "@/lib/api";
import { GithubRepoPicker } from "@/components/github-repo-picker";
import { repoShortName } from "@/lib/git-host";
import { BranchSelect } from "@/components/branch-select";
import { DokployImportDialog } from "@/components/dokploy-import-dialog";
import {
  DeploySummary,
  OutdatedSummary,
  PerfBadge,
  RowActions,
  VulnSummary,
  type RepoAction,
} from "@/components/repo-row-parts";
import { toast } from "sonner";
import { ConfigBadge } from "@/components/config-status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import {
  SchedulerFootnote,
  SchedulerNotice,
} from "@/components/scheduler-notice";
import { formatDateTime, formatRelative, scheduleLabel } from "@/lib/schedule";
import { useNarrowContent } from "@/hooks/use-narrow-content";
import { tx, useT } from "@/lib/i18n";

/** The schedule every new repository gets: every night at 03:00. */
const NIGHTLY = "0 3 * * *";

type RepoFilter = "all" | "critical" | "pr" | "deploy" | "outdated";

function LastScanBadge({ repo }: { repo: RepoListItem }) {
  const t = useT();
  if (repo.lastScanStatus === "pending" || repo.lastScanStatus === "running") {
    return (
      <Badge variant="secondary">
        <Spinner className="size-3" />
        {t("Scanning…")}
      </Badge>
    );
  }
  if (repo.lastScanStatus === "failed") {
    return (
      <Badge variant="destructive-soft">
        <AlertCircle />
        {t("Last scan failed")}
      </Badge>
    );
  }
  if (!repo.lastScannedAt) {
    return <Badge variant="outline">{t("Never scanned")}</Badge>;
  }
  return (
    <Badge variant="success">
      <CheckCircle2 />
      {t("Scanned {when}", { when: formatRelative(repo.lastScannedAt) ?? "" })}
    </Badge>
  );
}

/**
 * Only rendered for repos that carry a live URL — for the rest there is nothing
 * to say, and a grey "unknown" badge on every row would say it loudly.
 */
function LiveBadge({ repo }: { repo: RepoListItem }) {
  const t = useT();
  if (!repo.liveUrl) return null;
  if (!repo.liveStatus) {
    return (
      <Badge variant="outline">
        <Globe />
        {t("Live URL set")}
      </Badge>
    );
  }
  const up = repo.liveStatus === "up";
  return (
    <Badge
      variant={up ? "success" : "destructive-soft"}
      title={
        repo.liveCheckedAt
          ? (formatDateTime(repo.liveCheckedAt) ?? undefined)
          : undefined
      }
    >
      <Globe />
      {up ? t("Live") : t("Down")}
      {repo.liveCheckedAt && (
        <span className="opacity-70">
          · {formatRelative(repo.liveCheckedAt)}
        </span>
      )}
    </Badge>
  );
}

function ReposTableSkeleton() {
  return (
    <Card className="gap-0 py-0">
      {/* Visually hidden: the skeleton rows carry the meaning for sighted
          users, this carries it for everyone else. */}
      <span className="sr-only">{tx("Loading repositories…")}</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b px-6 py-4 last:border-0"
        >
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
      ))}
    </Card>
  );
}

export function ReposList() {
  const t = useT();
  const narrow = useNarrowContent();
  const [repos, setRepos] = useState<RepoListItem[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [rootDirectory, setRootDirectory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanningAll, setScanningAll] = useState(false);
  const [addMode, setAddMode] = useState<"pick" | "url">("pick");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RepoFilter>("all");
  const [picked, setPicked] = useState<GithubRepo[]>([]);
  const [scanAllNote, setScanAllNote] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .getRepos()
      .then(setRepos)
      .catch((e) => {
        setRepos([]);
        setError(e instanceof Error ? e.message : t("Failed to load repos"));
      })
      .finally(() => setLoading(false));
  };

  // Loaded once on mount; load itself is recreated every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), []);

  // While scans run, refresh quietly so their badges finish on their own.
  const anyScanning = (repos ?? []).some(
    (r) => r.lastScanStatus === "pending" || r.lastScanStatus === "running"
  );
  useEffect(() => {
    if (!anyScanning) return;
    const t = setInterval(() => {
      api
        .getRepos()
        .then(setRepos)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [anyScanning]);

  const scanAll = async () => {
    setError(null);
    setScanningAll(true);
    try {
      const r = await api.scanAll();
      setScanAllNote(
        t(
          r.started === 1 ? "{n} fast scan started" : "{n} fast scans started",
          {
            n: r.started,
          }
        ) +
          (r.skipped ? ` · ${t("{n} already running", { n: r.skipped })}` : "")
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to start the scans"));
    } finally {
      setScanningAll(false);
    }
  };

  // Whether the scheduler is running is instance state, not org state – a
  // failure here must never block the repo list.
  useEffect(() => {
    api
      .getSchedulerStatus()
      .then(setScheduler)
      .catch(() => setScheduler(null));
  }, []);

  const addPicked = async () => {
    if (!picked.length) return;
    setSubmitting(true);
    setError(null);
    const failed: string[] = [];
    for (const r of picked) {
      try {
        await api.createRepo({
          githubUrl: r.url,
          defaultBranch: r.defaultBranch,
        });
      } catch (e) {
        failed.push(
          `${r.fullName}: ${e instanceof Error ? e.message : "failed"}`
        );
      }
    }
    setSubmitting(false);
    load();
    if (failed.length) {
      setError(failed.join(" · "));
      setPicked(
        picked.filter((r) => failed.some((f) => f.startsWith(r.fullName)))
      );
    } else {
      setPicked([]);
      setAddOpen(false);
    }
  };

  const createRepo = async () => {
    if (!githubUrl.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const packageJsonPath =
        !rootDirectory.trim() || rootDirectory.trim() === "."
          ? undefined
          : rootDirectory.trim().replace(/\/+$/, "");
      await api.createRepo({
        githubUrl: githubUrl.trim(),
        defaultBranch: defaultBranch.trim() || undefined,
        packageJsonPath: packageJsonPath || undefined,
      });
      setAddOpen(false);
      setGithubUrl("");
      setDefaultBranch("");
      setRootDirectory("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to add repo"));
    } finally {
      setSubmitting(false);
    }
  };

  const [busy, setBusy] = useState<{ id: string; action: RepoAction } | null>(
    null
  );
  const refresh = () =>
    api
      .getRepos()
      .then(setRepos)
      .catch(() => {});

  const runAction = async (repo: RepoListItem, action: RepoAction) => {
    setBusy({ id: repo.id, action });
    try {
      if (action === "fast-scan" || action === "scan") {
        await api.startScan(repo.id, { fast: action === "fast-scan" });
        toast.success(
          action === "fast-scan"
            ? t("Scanning {name}…", { name: repo.name })
            : t("Full scan of {name} started", { name: repo.name })
        );
      } else if (action === "fix") {
        await api.startSecurityFix(repo.id);
        toast.success(
          t("Fixing CVEs in {name} — a PR follows", { name: repo.name })
        );
      } else if (action === "update") {
        await api.startUpdate(repo.id, { target: "minor" });
        toast.success(t("Updating {name} — a PR follows", { name: repo.name }));
      } else if (action === "deploy") {
        await api.deployRepo(repo.id);
        toast.success(t("Deploy of {name} started", { name: repo.name }));
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("That did not work"));
    } finally {
      setBusy(null);
    }
  };

  const scheduleBadge = (repo: RepoListItem) =>
    repo.scanSchedule ? (
      <Badge variant="outline">
        <Timer />
        {scheduleLabel(repo.scanSchedule)}
        {scheduler?.enabled && repo.nextScanAt && (
          <span
            className="text-muted-foreground"
            title={formatDateTime(repo.nextScanAt) ?? undefined}
          >
            ·{" "}
            {t("next {when}", { when: formatRelative(repo.nextScanAt) ?? "" })}
          </span>
        )}
      </Badge>
    ) : (
      <Badge variant="outline" className="text-muted-foreground">
        <Clock />
        {t("Manual only")}
      </Badge>
    );

  const actions = (repo: RepoListItem) => (
    <RowActions
      repo={repo}
      busy={busy?.id === repo.id ? busy.action : null}
      onAction={(a) => runAction(repo, a)}
    />
  );

  const [schedulingAll, setSchedulingAll] = useState(false);
  const scheduleAll = async () => {
    setSchedulingAll(true);
    try {
      for (const r of repos.filter((x) => !x.scanSchedule))
        await api.updateRepo(r.id, { scanSchedule: NIGHTLY });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Saving failed"));
    } finally {
      setSchedulingAll(false);
    }
  };

  const addButton = (
    <div className="flex flex-wrap gap-2">
      {(repos?.length ?? 0) > 0 && (
        <Button
          variant="outline"
          onClick={scanAll}
          disabled={scanningAll}
          title={t(
            "Lockfile + advisory database for every repository — no clone, about a second each"
          )}
        >
          {scanningAll ? <Spinner /> : <Zap />}
          {t("Check all now")}
        </Button>
      )}
      {/* One way in, three ways to fill it — instead of three buttons
          that look alike. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus />
            {t("Add")}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuItem
            onSelect={() => setImportOpen(true)}
            className="items-start"
          >
            <Download className="mt-0.5" />
            <span>
              <span className="block font-medium">
                {t("Take over everything from Dokploy")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t(
                  "Every site Dokploy deploys from GitHub, in one go. Recommended."
                )}
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setAddMode("pick");
              setPicked([]);
              setError(null);
              setAddOpen(true);
            }}
            className="items-start"
          >
            <Plus className="mt-0.5" />
            <span>
              <span className="block font-medium">{t("A repository")}</span>
              <span className="block text-xs text-muted-foreground">
                {t(
                  "Pick one or several from GitHub, GitLab, Bitbucket or Gitea."
                )}
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="items-start">
            <Link to="/new-site">
              <Rocket className="mt-0.5" />
              <span>
                <span className="block font-medium">
                  {t("A new site from a template")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(
                    "Repository, Dokploy app, database, domain and monitoring in one step."
                  )}
                </span>
              </span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DokployImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={load}
      />
    </div>
  );

  if (loading)
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("Repositories")}
          description={t("Connect a repository to scan its dependencies.")}
          actions={addButton}
        />
        <ReposTableSkeleton />
      </div>
    );

  const scheduled = repos.filter((r) => r.scanSchedule);
  const q = query.trim().toLowerCase();
  const shown = repos.filter((r) => {
    if (
      q &&
      !r.name.toLowerCase().includes(q) &&
      !r.githubUrl.toLowerCase().includes(q)
    )
      return false;
    if (filter === "critical")
      return (r.vulns?.critical ?? 0) + (r.vulns?.high ?? 0) > 0;
    if (filter === "pr") return !!r.openRun || !!r.openPrs?.length;
    if (filter === "deploy")
      return (
        r.liveStatus === "down" ||
        r.lastDeploy?.liveOk === false ||
        ["broken", "build_failed", "rollback_failed", "error_spike"].includes(
          r.lastDeploy?.guard ?? ""
        )
      );
    if (filter === "outdated") return (r.outdated?.major ?? 0) > 0;
    return true;
  });
  const count = (f: RepoFilter) =>
    f === "all"
      ? repos.length
      : repos.filter((r) =>
          f === "critical"
            ? (r.vulns?.critical ?? 0) + (r.vulns?.high ?? 0) > 0
            : f === "pr"
              ? !!r.openRun || !!r.openPrs?.length
              : f === "deploy"
                ? r.liveStatus === "down" ||
                  r.lastDeploy?.liveOk === false ||
                  [
                    "broken",
                    "build_failed",
                    "rollback_failed",
                    "error_spike",
                  ].includes(r.lastDeploy?.guard ?? "")
                : (r.outdated?.major ?? 0) > 0
        ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Repositories")}
        description={
          repos.length > 0
            ? t("{n} connected · {m} on a schedule", {
                n: repos.length,
                m: scheduled.length,
              })
            : t("Connect a repository to scan its dependencies.")
        }
        actions={addButton}
      />
      {scanAllNote && (
        <p className="-mt-3 text-sm text-muted-foreground">{scanAllNote}</p>
      )}

      {error && <ErrorAlert>{error}</ErrorAlert>}

      <SchedulerNotice status={scheduler} hasSchedules={scheduled.length > 0} />

      {repos.length > 0 && scheduled.length < repos.length && (
        <Alert>
          <CalendarClock />
          <AlertTitle>
            {repos.length - scheduled.length === 1
              ? t("1 repository is only checked when you click")
              : t("{n} repositories are only checked when you click", {
                  n: repos.length - scheduled.length,
                })}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {t(
                "New security holes are published every day. A nightly check finds them without anyone thinking of it."
              )}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={scheduleAll}
              disabled={schedulingAll}
            >
              {schedulingAll ? <Spinner /> : <CalendarClock />}
              {t("Check all every night")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {repos.length > 0 && (
        <div className="flex flex-col gap-3 @2xl/main:flex-row @2xl/main:items-center">
          <div className="relative @2xl/main:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search repositories")}
              aria-label={t("Search repositories")}
              className="pl-8"
            />
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter}
            onValueChange={(v) => v && setFilter(v as RepoFilter)}
            className="flex-wrap justify-start"
          >
            {(
              [
                ["all", "All"],
                ["critical", "Critical & high"],
                ["pr", "Open PRs"],
                ["deploy", "Deploy problems"],
                ["outdated", "Major updates"],
              ] as const
            ).map(([f, label]) => (
              <ToggleGroupItem key={f} value={f} className="gap-1.5 px-3">
                {t(label)}
                <span className="text-muted-foreground tabular-nums">
                  {count(f)}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      <Card className="gap-0 overflow-hidden py-0">
        {repos.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title={t("No repos yet")}
            description={t("Add a repository to scan packages.")}
            action={
              <Button variant="outline" onClick={() => setAddOpen(true)}>
                <Plus />
                {t("Add repo")}
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-6">{t("Repository")}</TableHead>
                <TableHead className="hidden @2xl/main:table-cell">
                  {t("Security holes")}
                </TableHead>
                <TableHead className="hidden @4xl/main:table-cell">
                  {t("Packages · Perf")}
                </TableHead>
                <TableHead className="hidden @3xl/main:table-cell">
                  {t("Deploy")}
                </TableHead>
                <TableHead className="hidden @5xl/main:table-cell">
                  {t("Status")}
                </TableHead>
                <TableHead className="hidden pr-6 text-right @2xl/main:table-cell">
                  <span className="sr-only">{t("Actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {t("No repository matches.")}
                  </TableCell>
                </TableRow>
              )}
              {shown.map((repo) => (
                <TableRow key={repo.id}>
                  <TableCell className="max-w-0 pr-6 pl-6 @2xl/main:max-w-none @2xl/main:pr-2">
                    <div className="flex items-center gap-3">
                      <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground sm:flex">
                        <FolderGit2 className="size-4" />
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        <Link
                          to="/repos/$repoId"
                          params={{ repoId: repo.id }}
                          className="block truncate font-medium hover:text-primary hover:underline"
                        >
                          {repo.name}
                        </Link>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {repoShortName(repo.githubUrl)}
                          {repo.defaultBranch ? ` · ${repo.defaultBranch}` : ""}
                        </p>
                      </div>
                    </div>
                    {narrow && (
                      // Phones: status, schedule and actions stack under the
                      // name instead of scrolling off to the right.
                      <div className="mt-2 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <VulnSummary repo={repo} />
                          <LastScanBadge repo={repo} />
                          <LiveBadge repo={repo} />
                          <ConfigBadge repo={repo} />
                        </div>
                        <DeploySummary repo={repo} />
                        {actions(repo)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden @2xl/main:table-cell">
                    <VulnSummary repo={repo} />
                  </TableCell>
                  <TableCell className="hidden @4xl/main:table-cell">
                    <div className="flex flex-col items-start gap-1">
                      <OutdatedSummary repo={repo} />
                      <PerfBadge repo={repo} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden @3xl/main:table-cell">
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-1">
                        <LiveBadge repo={repo} />
                        <ConfigBadge repo={repo} />
                      </div>
                      <DeploySummary repo={repo} />
                    </div>
                  </TableCell>
                  <TableCell className="hidden @5xl/main:table-cell">
                    <div className="flex flex-col items-start gap-1">
                      <LastScanBadge repo={repo} />
                      {scheduleBadge(repo)}
                    </div>
                  </TableCell>
                  <TableCell className="hidden pr-6 @2xl/main:table-cell">
                    {actions(repo)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <SchedulerFootnote status={scheduler} />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Add repositories")}</DialogTitle>
            <DialogDescription>
              {addMode === "pick"
                ? t(
                    "Pick from the repositories your Git tokens can read — connected ones are hidden."
                  )
                : t(
                    "Connect a repository by URL — GitHub, GitLab, Bitbucket or Gitea/Forgejo. Set branch and root directory for monorepos."
                  )}
            </DialogDescription>
          </DialogHeader>
          {addMode === "pick" ? (
            <div className="grid gap-3">
              <GithubRepoPicker
                selected={picked}
                onChange={setPicked}
                onUnavailable={() => setAddMode("url")}
              />
              {addOpen && error && <ErrorAlert>{error}</ErrorAlert>}
              <Button
                variant="link"
                size="sm"
                className="h-auto justify-self-start p-0"
                onClick={() => setAddMode("url")}
              >
                {t("Enter a URL instead")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="add-repo-url">{t("Repository URL")}</Label>
                <Input
                  id="add-repo-url"
                  placeholder="https://github.com/owner/repo"
                  value={githubUrl}
                  onChange={(e) => {
                    setGithubUrl(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createRepo();
                    }
                  }}
                  autoFocus
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add-repo-branch">{t("Branch")}</Label>
                <BranchSelect
                  id="add-repo-branch"
                  githubUrl={githubUrl}
                  value={defaultBranch}
                  onChange={setDefaultBranch}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add-repo-root">
                  {t("Root directory (optional)")}
                </Label>
                <Input
                  id="add-repo-root"
                  placeholder={t(
                    "e.g. apps/web or packages/api — leave empty for repo root"
                  )}
                  value={rootDirectory}
                  onChange={(e) => setRootDirectory(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    "For monorepos: path to the folder containing package.json."
                  )}
                </p>
              </div>
              {/* Errors from loading branches or adding the repo belong next to
                the form that caused them, not behind the dialog overlay. */}
              {addOpen && error && <ErrorAlert>{error}</ErrorAlert>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t("Cancel")}
            </Button>
            {addMode === "pick" ? (
              <Button
                onClick={addPicked}
                disabled={submitting || picked.length === 0}
              >
                {submitting && <Spinner />}
                {submitting
                  ? t("Adding…")
                  : picked.length > 1
                    ? t("Add {n} repositories", { n: picked.length })
                    : t("Add repository")}
              </Button>
            ) : (
              <Button
                onClick={createRepo}
                disabled={submitting || !githubUrl.trim()}
              >
                {submitting && <Spinner />}
                {submitting ? t("Adding…") : t("Add repository")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
