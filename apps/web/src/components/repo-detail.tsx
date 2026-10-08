import { useCallback, useEffect, useMemo, useState } from "react";
import { compareUrl, hostLabel } from "@/lib/git-host";
import { toast } from "sonner";
import { useParams, Link, useNavigate } from "@tanstack/react-router";
import {
  api,
  type Vulnerability,
  type Repo,
  type VerifyMode,
  type SchedulerStatus,
  type UpdateRun,
  type DeployRun,
  type Scan,
  type ServerFinding,
  type ServerListItem,
  type DokployApp,
  type ClientListItem,
} from "@/lib/api";
import { compareVulnerabilities } from "@/lib/live-gap";
import {
  SCHEDULE_OPTIONS,
  cronToScheduleValue,
  formatDateTime,
  formatRelative,
  scheduleLabel,
  scheduleValueToCron,
} from "@/lib/schedule";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatBand, StatCard } from "@/components/stat-card";
import { SeverityBadge } from "@/components/severity-badge";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { LogErrorsCard } from "@/components/log-errors-card";
import {
  deployPlatform,
  hasDeployTarget,
  openInPlatform,
} from "@/lib/platform";
import { IncidentsCard } from "@/components/incidents-card";
import { BranchesCard } from "@/components/branches-card";
import { MigrationsCard } from "@/components/migrations-card";
import { MaintenanceButton } from "@/components/maintenance-button";
import { ChecksCard } from "@/components/checks-card";
import { CodeBlock, FindingsTable } from "@/components/server-ui";
import { BranchSelect } from "@/components/branch-select";
import { ConfigCard } from "@/components/config-status";
import { SiteProbeCard } from "@/components/site-probe-card";
import { PerfCard } from "@/components/perf-card";
import { cn } from "@/lib/utils";
import { buildWorkflow, type BuildDatabase } from "@/lib/build-workflow";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  MoreHorizontal,
  ExternalLink,
  GitBranch,
  GitMerge,
  Globe,
  PackageSearch,
  RefreshCw,
  Rocket,
  Settings,
  Radar,
  ShieldCheck,
  Terminal,
  Trash2,
  Undo2,
  Wrench,
  XCircle,
  Copy,
  Download,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyFindings, downloadFindings } from "@/lib/findings-export";
import { RepoVerdict } from "@/components/repo-verdict";
import { useSystemMode } from "@/lib/system-mode";
import { tx } from "@/lib/i18n";

type Finding = {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  isDevDependency: boolean;
  unused?: boolean;
};

const SCAN_STEPS = [
  { id: "fetch_package_json", label: "Read the packages" },
  { id: "clone_depcheck", label: "Find unused packages" },
  { id: "audit", label: "Look for known security holes" },
  { id: "fetch_versions", label: "Look up newer versions" },
] as const;

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  info: 4,
};

/** Phase inside a status, reported by the workflow as `currentStep`. */
const PHASE_LABELS: Record<string, string> = {
  clone: "Cloning the repository",
  check_updates: "Looking up newer versions",
  install: "Installing dependencies",
  audit_fix: "Fixing the lockfile",
  waiting: "Waiting for the build slot",
  ci: "Waiting for the repository's CI checks",
  merge_held: "Auto-merge held back — see the log",
  build: "Building",
  test: "Running tests",
  commit_push: "Committing and pushing",
  pr: "Opening the pull request",
};

const STEP_LABELS: Record<string, string> = {
  created: "Created",
  updating: "Updating",
  build_running: "Build & test",
  pushed: "Pushed",
  pr_opened: "PR opened",
  merged: "Merged",
  deploying: "Deploying",
  deployed: "Deployed",
  closed: "PR closed",
};

const AFTER_PR = ["merged", "deploying", "deployed"];

function runSteps(
  kind: string,
  repo: { autoMerge: boolean; autoDeploy: boolean } | null,
  status?: string
): string[] {
  if (kind !== "security") {
    // Manual updates end with their PR; they are never merged automatically
    // — only by hand ("Merge & deploy"), which then adds its steps.
    const base = ["created", "updating", "build_running", "pr_opened"];
    if (!status || !AFTER_PR.includes(status)) return base;
    return [
      ...base,
      "merged",
      ...(status === "merged" ? [] : ["deploying", "deployed"]),
    ];
  }
  return [
    "created",
    "updating",
    "build_running",
    "pr_opened",
    ...(repo?.autoMerge ? ["merged"] : []),
    ...(repo?.autoDeploy ? ["deploying", "deployed"] : []),
  ];
}

const RUN_TERMINAL = new Set(["pushed", "deployed", "failed", "closed"]);
function isRunTerminal(
  status: string,
  repo: { autoMerge: boolean; autoDeploy: boolean } | null,
  kind?: string,
  currentStep?: string | null
): boolean {
  if (RUN_TERMINAL.has(status)) return true;
  // Auto-merge decided not to merge: the run is over, the PR is open.
  if (currentStep === "merge_held") return true;
  if (
    kind &&
    kind !== "security" &&
    (status === "pr_opened" || status === "merged")
  )
    return true;
  if (status === "pr_opened" && !repo?.autoMerge) return true;
  if (status === "merged" && !repo?.autoDeploy) return true;
  return false;
}

type StepState = "done" | "active" | "failed" | "pending";

/** Same icon language for scan steps and update-run steps. */
function StepIcon({ state }: { state: StepState }) {
  if (state === "done")
    return <CheckCircle2 className="size-4 shrink-0 text-success" />;
  if (state === "active")
    return <Spinner className="size-4 shrink-0 text-primary" />;
  if (state === "failed")
    return <XCircle className="size-4 shrink-0 text-destructive" />;
  return <Circle className="size-4 shrink-0 text-muted-foreground/40" />;
}

/** Where a branch scan stands, step by step, from its `currentStep`. */
function scanStepStates(scan: Scan) {
  return SCAN_STEPS.map((step, i) => {
    const current = scan.currentStep ?? null;
    const stepId = step.id;
    const currentStepId = current?.startsWith("fetch_versions")
      ? "fetch_versions"
      : current;
    const stepIndex = SCAN_STEPS.findIndex(
      (s) => s.id === (currentStepId ?? "")
    );
    const done =
      scan.status === "success"
        ? true
        : stepIndex > i || (stepIndex === i && currentStepId !== stepId);
    const active =
      scan.status === "running" &&
      (current === stepId || !!current?.startsWith(stepId + ":"));
    const progress =
      stepId === "fetch_versions" && current?.startsWith("fetch_versions:")
        ? (() => {
            const m = current.match(/^fetch_versions:(\d+):(\d+)$/);
            return m ? ` (${m[1]}/${m[2]})` : "";
          })()
        : "";
    const state: StepState = done ? "done" : active ? "active" : "pending";
    return { id: step.id, label: tx(step.label), progress, state };
  });
}

/** Where an update/fix run stands, step by step, from its status. */
function runStepStates(
  run: UpdateRun,
  repo: { autoMerge: boolean; autoDeploy: boolean } | null
) {
  const steps = runSteps(run.kind, repo, run.status);
  // Manual runs from before PRs were opened ended at "pushed".
  const status =
    run.kind !== "security" && run.status === "pushed"
      ? "pr_opened"
      : run.status;
  const currentIndex = status === "failed" ? -1 : steps.indexOf(status);
  return steps.map((stepId, i) => {
    const done =
      status === "failed"
        ? i < steps.indexOf("build_running")
        : i < currentIndex ||
          (i === currentIndex &&
            isRunTerminal(status, repo, run.kind, run.currentStep));
    const active = status !== "failed" && stepId === status;
    const failed = status === "failed" && i === steps.indexOf("build_running");
    const state: StepState = failed
      ? "failed"
      : done
        ? "done"
        : active
          ? "active"
          : "pending";
    return { id: stepId, label: tx(STEP_LABELS[stepId] ?? stepId), state };
  });
}

function percentDone(states: Array<{ state: StepState }>): number {
  if (states.length === 0) return 0;
  return Math.round(
    (states.filter((s) => s.state === "done").length / states.length) * 100
  );
}

/** Radix Select reserves "" for "no value", but "" is the stored "Off". */
const SCHEDULE_OFF = "off";
const SERVER_NONE = "none";
const DOKPLOY_NONE = "none";

/** "owner/repo" of a GitHub URL, lowercased — how Dokploy names its source. */
function repoSlug(url: string | undefined): string | null {
  const m = url?.match(/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

export function RepoDetail() {
  const { repoId } = useParams({ from: "/repos/$repoId" });
  const navigate = useNavigate();
  const [repo, setRepo] = useState<Repo | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [loading, setLoading] = useState(true);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editBranch, setEditBranch] = useState("");
  const [editRoot, setEditRoot] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [withAi, setWithAi] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<"minor" | "latest">("minor");
  const [updating, setUpdating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [editAutoFix, setEditAutoFix] = useState(false);
  const [editAutoFixForce, setEditAutoFixForce] = useState(false);
  const [editAutoMerge, setEditAutoMerge] = useState(false);
  const [editAutoDeploy, setEditAutoDeploy] = useState(false);
  const [editAutoRollback, setEditAutoRollback] = useState(false);
  const [editAutoHeal, setEditAutoHeal] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<{
    ok: boolean;
    detail: string;
  } | null>(null);
  const [editVerifyMode, setEditVerifyMode] = useState<VerifyMode>("typecheck");
  const mode = useSystemMode();
  const [wfDatabase, setWfDatabase] = useState<BuildDatabase>("postgres");
  const [editDokployAppId, setEditDokployAppId] = useState("");
  const [editCoolifyUuid, setEditCoolifyUuid] = useState("");
  // "komodo|<id>" or "portainer|<endpoint:id>", "" for none.
  const [editStack, setEditStack] = useState("");
  // Empty: neither Komodo nor Portainer runs a Git stack — field hidden.
  const [stackApps, setStackApps] = useState<Array<{
    platform: "komodo" | "portainer";
    id: string;
    name: string;
    repoUrl: string | null;
    branch: string | null;
  }> | null>(null);
  // undefined: Coolify not connected — the field is hidden.
  const [coolifyApps, setCoolifyApps] = useState<
    | Array<{
        uuid: string;
        name: string;
        githubRepo: string | null;
        branch: string | null;
      }>
    | null
    | undefined
  >(undefined);
  const [editLiveUrl, setEditLiveUrl] = useState("");
  const [domainSuggestions, setDomainSuggestions] = useState<string[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [checkingLive, setCheckingLive] = useState(false);
  const [lastDeploy, setLastDeploy] = useState<DeployRun | null>(null);
  const [liveVulns, setLiveVulns] = useState<Vulnerability[]>([]);
  const [liveScanning, setLiveScanning] = useState(false);
  const [liveCheckError, setLiveCheckError] = useState<string | null>(null);
  const [liveScanNote, setLiveScanNote] = useState<string | null>(null);
  const [editSchedule, setEditSchedule] = useState("");
  const [editServerId, setEditServerId] = useState("");
  const [editClientId, setEditClientId] = useState("");
  const [clientOptions, setClientOptions] = useState<ClientListItem[]>([]);
  const [servers, setServers] = useState<ServerListItem[] | null>(null);
  const [liveFindings, setLiveFindings] = useState<ServerFinding[] | null>(
    null
  );
  const [pollingUpdateRunId, setPollingUpdateRunId] = useState<string | null>(
    null
  );
  const [updateRun, setUpdateRun] = useState<UpdateRun | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [dokployApps, setDokployApps] = useState<DokployApp[] | null>(null);
  const [dokployProjects, setDokployProjects] = useState<number | null>(null);
  const [dokployAppsError, setDokployAppsError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [aligning, setAligning] = useState(false);
  const [alignNote, setAlignNote] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const loadScans = useCallback(() => {
    if (!repoId) return;
    api
      .getScans(repoId)
      .then(setScans)
      .catch(() => setScans([]));
  }, [repoId]);

  useEffect(() => {
    if (!repoId) return;
    setLoading(true);
    setUpdateRun(null);
    api
      .getRepo(repoId)
      .then(setRepo)
      .catch(() => setRepo(null))
      .finally(() => setLoading(false));
  }, [repoId]);

  useEffect(() => {
    if (!repoId) return;
    api
      .getScans(repoId)
      .then(setScans)
      .catch(() => setScans([]));
  }, [repoId]);

  // Pick the newest update/fix run back up on mount. Without this, reloading
  // the page while an update is running loses every trace of it until it
  // finishes — the most common reason progress "disappears".
  useEffect(() => {
    if (!repoId) return;
    api
      .getRepoUpdateRuns(repoId)
      .then((runs) => {
        const latest = runs[0];
        if (!latest) return;
        setUpdateRun(latest);
        if (latest.status !== "failed") setPollingUpdateRunId(latest.id);
      })
      .catch(() => {});
  }, [repoId]);

  // The newest deploy run, plus the repo's live state. Without this the
  // watcher's verdict would only ever reach the notification channels.
  const loadDeployState = useCallback(async () => {
    if (!repoId) return;
    try {
      const [runs, fresh] = await Promise.all([
        api.getRepoDeployRuns(repoId),
        api.getRepo(repoId),
      ]);
      setLastDeploy(runs[0] ?? null);
      setRepo(fresh);
    } catch {
      // A failed refresh leaves the last known state on screen.
    }
  }, [repoId]);

  useEffect(() => {
    loadDeployState();
  }, [loadDeployState]);

  // What the server-side tools see on the running application (Nuclei,
  // Uptime Kuma) — the other half of "is production affected?".
  useEffect(() => {
    if (!repoId) return;
    api
      .getRepoLiveFindings(repoId)
      .then(setLiveFindings)
      .catch(() => setLiveFindings([]));
  }, [repoId, repo?.serverId]);

  // A deploy whose live watch is still open ("succeeded" = accepted, no
  // verdict yet) is the one moment where this page has something new to show
  // every few seconds.
  const watchingDeploy =
    !!repo?.liveUrl &&
    lastDeploy?.status === "succeeded" &&
    lastDeploy.liveOk === null;

  useEffect(() => {
    if (!watchingDeploy) return;
    const interval = setInterval(loadDeployState, 15000);
    return () => clearInterval(interval);
  }, [watchingDeploy, loadDeployState]);

  // Instance-level: whether scheduled scans actually run on this API.
  useEffect(() => {
    api
      .getSchedulerStatus()
      .then(setScheduler)
      .catch(() => setScheduler(null));
  }, []);

  // Two kinds of scan live in the same list: the branch (what the code says)
  // and the deployed commit (what is actually running). Mixing them would make
  // "latest scan" mean whichever ran last, which is not a useful sentence.
  const lastScan = scans.find((s) => s.target !== "live");
  const liveScan = scans.find((s) => s.target === "live");
  const isScanInProgress = [lastScan, liveScan].some(
    (s) => s?.status === "pending" || s?.status === "running"
  );

  useEffect(() => {
    if (!isScanInProgress || !repoId) return;
    const interval = setInterval(loadScans, 2000);
    return () => clearInterval(interval);
  }, [isScanInProgress, repoId, loadScans]);

  useEffect(() => {
    if (!lastScan?.id) {
      setFindings([]);
      setVulns([]);
      return;
    }
    if (lastScan.status === "pending" || lastScan.status === "running") {
      setFindings([]);
      setVulns([]);
      return;
    }
    api
      .getFindings(lastScan.id)
      .then(setFindings)
      .catch(() => setFindings([]));
    api
      .getVulnerabilities(lastScan.id)
      .then((v) =>
        setVulns(
          [...v].sort(
            (a, b) =>
              (SEVERITY_ORDER[a.severity] ?? 9) -
              (SEVERITY_ORDER[b.severity] ?? 9)
          )
        )
      )
      .catch(() => setVulns([]));
  }, [lastScan?.id, lastScan?.status]);

  useEffect(() => {
    if (!liveScan?.id || liveScan.status !== "success") {
      setLiveVulns([]);
      return;
    }
    api
      .getVulnerabilities(liveScan.id)
      .then(setLiveVulns)
      .catch(() => setLiveVulns([]));
  }, [liveScan?.id, liveScan?.status]);

  const gap = useMemo(
    () => compareVulnerabilities(liveVulns, vulns),
    [liveVulns, vulns]
  );

  const startLiveScan = () => {
    if (!repoId) return;
    setLiveScanning(true);
    setLiveCheckError(null);
    setLiveScanNote(null);
    api
      .startLiveScan(repoId)
      .then((r) => {
        setLiveScanNote(
          `Scanning commit ${r.commit.slice(0, 7)} — ${
            r.source === "live"
              ? "reported by the site"
              : r.source === "dokploy"
                ? "recorded by Dokploy for the last successful deploy"
                : "the newest commit on the branch when Dokploy's last successful deploy started"
          }.`
        );
        loadScans();
      })
      .catch((e) =>
        setLiveCheckError(
          e instanceof Error ? e.message : tx("Live scan failed")
        )
      )
      .finally(() => setLiveScanning(false));
  };

  const startScan = () => {
    if (!repoId) return;
    setScanning(true);
    api
      .startScan(repoId)
      .then(loadScans)
      .finally(() => setScanning(false));
  };

  const openSettings = () => {
    setEditBranch(repo?.defaultBranch ?? "main");
    setEditRoot(
      repo?.packageJsonPath && repo.packageJsonPath !== "package.json"
        ? repo.packageJsonPath.replace(/\/package\.json$/, "")
        : ""
    );
    setEditAutoFix(repo?.autoFixCritical ?? false);
    setEditAutoFixForce(repo?.autoFixForce ?? false);
    setEditAutoMerge(repo?.autoMerge ?? false);
    setEditAutoDeploy(repo?.autoDeploy ?? false);
    setEditAutoRollback(repo?.autoRollback ?? false);
    setEditAutoHeal(repo?.autoHeal ?? false);
    setEditVerifyMode(repo?.verifyMode ?? "typecheck");
    setEditDokployAppId(repo?.dokployApplicationId ?? "");
    setEditCoolifyUuid(repo?.coolifyAppUuid ?? "");
    setEditStack(
      repo?.platformKind && repo.platformAppId
        ? `${repo.platformKind}|${repo.platformAppId}`
        : ""
    );
    setStackApps(null);
    api
      .getStackApps()
      .then(({ apps }) => setStackApps(apps))
      .catch(() => setStackApps([]));
    setCoolifyApps(null);
    api
      .getCoolifyApps()
      .then(({ apps }) => setCoolifyApps(apps))
      .catch(() => setCoolifyApps(undefined));
    setEditLiveUrl(repo?.liveUrl ?? "");
    setDomainSuggestions([]);
    setEditSchedule(cronToScheduleValue(repo?.scanSchedule ?? null));
    setEditServerId(repo?.serverId ?? "");
    setEditClientId(repo?.clientId ?? "");
    api
      .getClients()
      .then(setClientOptions)
      .catch(() => setClientOptions([]));
    api
      .getServers()
      .then(setServers)
      .catch(() => setServers([]));
    setDokployApps(null);
    setDokployAppsError(null);
    api
      .getDokployApps()
      .then(({ apps, projects }) => {
        setDokployApps(apps);
        setDokployProjects(projects ?? null);
      })
      .catch((e) => {
        setDokployApps([]);
        setDokployAppsError(
          e instanceof Error ? e.message : tx("Could not reach Dokploy")
        );
      });
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    if (!repoId) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const path =
        !editRoot.trim() || editRoot.trim() === "."
          ? "package.json"
          : editRoot.trim().endsWith("package.json")
            ? editRoot.trim()
            : `${editRoot.trim().replace(/\/+$/, "")}/package.json`;
      // Enforce the escalation ladder client-side (server enforces it too).
      const autoFix = editAutoFix;
      const autoMerge = autoFix && editAutoMerge;
      const autoDeploy = autoMerge && editAutoDeploy;
      const updated = await api.updateRepo(repoId, {
        defaultBranch: editBranch.trim() || "main",
        packageJsonPath: path,
        autoFixCritical: autoFix,
        autoFixForce: autoFix && editAutoFixForce,
        autoMerge,
        autoDeploy,
        autoRollback: editAutoRollback,
        autoHeal: editAutoHeal,
        verifyMode: editVerifyMode,
        dokployApplicationId: editDokployAppId.trim() || null,
        coolifyAppUuid: editCoolifyUuid || null,
        platformApp: editStack
          ? {
              kind: editStack.split("|")[0] as "komodo" | "portainer",
              id: editStack.slice(editStack.indexOf("|") + 1),
            }
          : null,
        liveUrl: editLiveUrl.trim() || null,
        scanSchedule: scheduleValueToCron(editSchedule),
        serverId: editServerId || null,
        clientId: editClientId || null,
      });
      setRepo(updated);
      setSettingsOpen(false);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : tx("Save failed"));
    } finally {
      setSavingSettings(false);
    }
  };

  const startFix = () => {
    if (!repoId) return;
    setFixing(true);
    api
      .startSecurityFix(repoId)
      .then((result) => {
        setUpdateRun({
          id: result.id,
          status: result.status,
          currentStep: null,
          buildOk: null,
          logOutput: null,
          prUrl: null,
          merged: false,
          kind: "security",
          securityVerified: null,
          securitySummary: null,
        });
        setPollingUpdateRunId(result.id);
      })
      .finally(() => setFixing(false));
  };

  const checkLive = () => {
    if (!repoId) return;
    setCheckingLive(true);
    setLiveCheckError(null);
    api
      .checkLive(repoId)
      .then((state) => setRepo((r) => (r ? { ...r, ...state } : r)))
      .catch((e) =>
        setLiveCheckError(e instanceof Error ? e.message : tx("Check failed"))
      )
      .finally(() => setCheckingLive(false));
  };

  // Dokploy already knows which domains point at the application, so the URL
  // can be picked rather than typed (and mistyped).
  const loadDokployDomains = () => {
    if (!repoId) return;
    setLoadingDomains(true);
    setSettingsError(null);
    api
      .getDokployDomains(repoId)
      .then(({ urls }) => {
        setDomainSuggestions(urls);
        if (urls.length === 0) {
          setSettingsError("Dokploy reported no domains for this application.");
        } else if (!editLiveUrl.trim()) {
          setEditLiveUrl(urls[0]!);
        }
      })
      .catch((e) =>
        setSettingsError(
          e instanceof Error ? e.message : tx("Could not reach Dokploy")
        )
      )
      .finally(() => setLoadingDomains(false));
  };

  const rootDisplay =
    repo?.packageJsonPath && repo.packageJsonPath !== "package.json"
      ? repo.packageJsonPath.replace(/\/package\.json$/, "")
      : "—";

  useEffect(() => {
    if (!pollingUpdateRunId) return;
    const tick = async () => {
      try {
        const run = await api.getUpdateRun(pollingUpdateRunId);
        setUpdateRun(run);
        if (isRunTerminal(run.status, repo, run.kind, run.currentStep)) {
          setPollingUpdateRunId(null);
          loadScans();
          // A security run can end in a deploy – pick that up right away.
          loadDeployState();
        }
      } catch {
        setPollingUpdateRunId(null);
        setUpdateRun(null);
      }
    };
    tick();
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [pollingUpdateRunId, loadScans, loadDeployState, repo]);

  const startUpdate = async () => {
    if (!repoId) return;
    setUpdating(true);
    try {
      const result = await api.startUpdate(repoId, {
        withAi,
        target: updateTarget,
      });
      setUpdateOpen(false);
      setUpdateRun({
        id: result.id,
        status: result.status,
        currentStep: null,
        buildOk: null,
        logOutput: null,
        prUrl: null,
        merged: false,
        kind: "manual",
      });
      setPollingUpdateRunId(result.id);
    } finally {
      setUpdating(false);
    }
  };

  // Merge the PR on GitHub and hand the default branch to Dokploy — the run
  // card then shows how far it got.
  const confirmMerge = async () => {
    if (!repoId || !updateRun) return;
    setMerging(true);
    setMergeError(null);
    try {
      const res = await api.mergeRun(
        repoId,
        updateRun.id,
        hasDeployTarget(repo)
      );
      setUpdateRun(await api.getUpdateRun(updateRun.id));
      setMergeOpen(false);
      if (res.deployError) setMergeError(res.deployError);
      loadDeployState();
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : tx("Merge failed"));
    } finally {
      setMerging(false);
    }
  };

  // Pin packages released together to one version on the run's branch.
  const alignVersions = async () => {
    if (!repoId || !updateRun) return;
    setAligning(true);
    setAlignNote(null);
    try {
      const res = await api.alignRunVersions(repoId, updateRun.id);
      const n = Object.keys(res.pinned).length;
      setAlignNote(
        n
          ? `Fixed ${n} package${n === 1 ? "" : "s"} and pushed to the pull request — its checks run again.`
          : "Everything already matches on the branch."
      );
      setUpdateRun(await api.getUpdateRun(updateRun.id));
    } catch (e) {
      setAlignNote(
        e instanceof Error ? e.message : tx("Could not fix the versions")
      );
    } finally {
      setAligning(false);
    }
  };

  const confirmRollback = async () => {
    if (!repoId || !lastDeploy) return;
    setRollingBack(true);
    try {
      setRollbackResult(await api.rollbackDeploy(repoId, lastDeploy.id));
    } catch (e) {
      setRollbackResult({
        ok: false,
        detail: e instanceof Error ? e.message : tx("Rollback failed"),
      });
    } finally {
      setRollingBack(false);
      setRollbackOpen(false);
      loadDeployState();
    }
  };

  const confirmDelete = async () => {
    if (!repoId) return;
    setDeleting(true);
    try {
      await api.deleteRepo(repoId);
      setDeleteOpen(false);
      navigate({ to: "/repos" });
    } catch (e) {
      setDeleting(false);
      throw e;
    }
    setDeleting(false);
  };

  const statusVariant = (current: string, latest: string) => {
    if (current === latest) return "success";
    const c = current.split(".").map(Number);
    const l = latest.split(".").map(Number);
    if (c[0] !== l[0]) return "destructive-soft";
    return "warning";
  };

  // A failed run's log is the explanation, so it opens by itself; a running
  // one stays folded until asked for.
  const updateRunStatus = updateRun?.status;
  useEffect(() => {
    if (updateRunStatus === "failed") setLogOpen(true);
  }, [updateRunStatus]);

  if (loading || !repo)
    return (
      <div className="space-y-6">
        <span className="sr-only">{tx("Loading…")}</span>
        <Skeleton className="h-5 w-28" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
        </div>
        <Skeleton className="h-56 rounded-lg" />
      </div>
    );

  const branch = repo.defaultBranch ?? "main";
  const scanSteps = lastScan ? scanStepStates(lastScan) : [];
  const runStepList = updateRun ? runStepStates(updateRun, repo) : [];
  // The PR, or — when opening it failed — the host's "new PR" page for the
  // pushed branch, where it can be opened by hand.
  const branchLink =
    updateRun?.prUrl ??
    (updateRun?.branchName &&
    repo?.githubUrl &&
    ["pushed", "pr_opened"].includes(updateRun.status)
      ? compareUrl(
          repo.githubUrl,
          repo.defaultBranch ?? "main",
          updateRun.branchName,
          repo.gitHost
        )
      : null);
  const outdatedCount = findings.filter(
    (f) => f.currentVersion !== f.latestVersion
  ).length;
  const unusedCount = findings.filter((f) => f.unused).length;
  const urgentCount = vulns.filter(
    (v) => v.severity === "critical" || v.severity === "high"
  ).length;

  return (
    <div className="space-y-6">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
      >
        <Link to="/repos">
          <ChevronLeft />
          {tx("Repositories")}
        </Link>
      </Button>
      <PageHeader
        title={repo.name}
        description={
          <a
            href={repo.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs hover:text-foreground hover:underline"
          >
            {repo.githubUrl}
            <ExternalLink className="size-3" />
          </a>
        }
        actions={
          <>
            <MaintenanceButton scope="repository" targetId={repo.id} />
            {hasDeployTarget(repo) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  openInPlatform(repo.id, api.getPlatformLink, (m) =>
                    toast.error(m)
                  )
                }
              >
                <ExternalLink />
                {tx("Open in {platform}", {
                  platform: deployPlatform(repo) ?? "Dokploy",
                })}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={openSettings}>
              <Settings />
              {tx("Settings")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label={tx("More actions")}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => copyFindings(repo.id)}>
                  <Copy />
                  {tx("Copy findings for an AI agent")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => downloadFindings(repo.id, repo.name)}
                >
                  <Download />
                  {tx("Download findings.md")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <Trash2 />
                  {tx("Delete repo")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {lastScan?.status === "success" && (
        /* Derived from the latest branch scan already on screen below — a
           summary, not another source of truth. */
        <StatBand>
          <StatCard
            label={tx("Security holes")}
            value={lastScan.auditNote ? "—" : vulns.length}
            tone={urgentCount > 0 ? "destructive" : "warning"}
            description={
              lastScan.auditNote
                ? tx("audit did not run")
                : urgentCount > 0
                  ? tx("{n} critical or serious", { n: urgentCount })
                  : tx("none critical or high")
            }
          />
          <StatCard
            label={tx("Outdated packages")}
            value={outdatedCount}
            tone="warning"
            description={tx("of {n} packages", { n: findings.length })}
          />
          <StatCard
            label={tx("Unused packages")}
            value={unusedCount}
            description={tx("not imported anywhere")}
          />
          <StatCard
            label={tx("Live site")}
            value={
              !repo.liveUrl
                ? "—"
                : repo.liveStatus === "up"
                  ? tx("Online")
                  : repo.liveStatus === "down"
                    ? tx("Offline")
                    : "—"
            }
            tone={
              repo.liveStatus === "up"
                ? "success"
                : repo.liveStatus === "down"
                  ? "destructive"
                  : "default"
            }
            description={
              !repo.liveUrl
                ? tx("no live URL set")
                : repo.liveCheckedAt
                  ? tx("checked {when}", {
                      when: formatRelative(repo.liveCheckedAt) ?? "",
                    })
                  : tx("not checked yet")
            }
          />
        </StatBand>
      )}

      <RepoVerdict
        repo={repo}
        lastScan={lastScan ?? null}
        vulns={vulns}
        onFix={startFix}
        onScan={startScan}
        fixing={fixing}
        scanning={scanning}
        fixRunning={
          updateRun?.kind === "security" &&
          !["failed", "closed"].includes(updateRun.status)
        }
      />

      {lastScan?.status === "success" && (
        <Card className="gap-0 overflow-hidden pb-0">
          <CardHeader className="border-b pb-4 [.border-b]:pb-4">
            <CardTitle>{tx("Known security holes")}</CardTitle>
            <CardDescription>
              {tx(
                "In the packages this site uses, from the public advisory databases. Most disappear with an update."
              )}
            </CardDescription>
          </CardHeader>
          {lastScan?.auditNote ? (
            // An audit that could not run must never look like a clean bill
            // of health – that is the one mistake this list cannot afford.
            <div className="p-6">
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>
                  {tx("No vulnerability data for this scan")}
                </AlertTitle>
                <AlertDescription>{lastScan.auditNote}</AlertDescription>
              </Alert>
            </div>
          ) : vulns.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={tx("No known security holes.")}
              className="py-8 md:py-8"
            />
          ) : (
            <ul className="divide-y">
              {vulns.map((v) => (
                <li key={v.id} className="flex items-start gap-3 px-6 py-3">
                  <SeverityBadge severity={v.severity} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm">
                      <span className="font-mono font-medium">
                        {v.packageName}
                      </span>
                      {v.title && (
                        <span className="text-muted-foreground">
                          {" — "}
                          {v.title}
                        </span>
                      )}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {v.fixAvailable ? (
                        <span className="font-medium text-foreground">
                          {v.patchedVersion
                            ? tx("Fixed by updating to {version}", {
                                version: v.patchedVersion,
                              })
                            : tx("Fixed by an update")}
                        </span>
                      ) : (
                        <span>{tx("No fix exists yet")}</span>
                      )}
                      {v.fixIsSemverMajor && (
                        <Badge
                          variant="warning"
                          title={tx(
                            "A major version: the site may need small changes to work with it."
                          )}
                        >
                          {tx("major update")}
                        </Badge>
                      )}
                      <span aria-hidden>·</span>
                      <span>
                        {v.isDirect
                          ? tx("in your package.json")
                          : tx("comes in through another package")}
                      </span>
                      {v.url && (
                        <>
                          <span aria-hidden>·</span>
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-primary hover:underline"
                          >
                            {v.ghsaId ?? v.cveId ?? tx("Details")}
                            <ExternalLink className="size-3" />
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {updateRun && (
        <Card>
          <CardHeader>
            <CardTitle>
              {updateRun.kind === "security"
                ? tx("Security fix run")
                : tx("Update run")}
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  updateRun.status === "deployed" ||
                  updateRun.status === "merged" ||
                  updateRun.status === "pushed" ||
                  updateRun.status === "pr_opened"
                    ? "success"
                    : updateRun.status === "failed"
                      ? "destructive-soft"
                      : "secondary"
                }
              >
                {tx(STEP_LABELS[updateRun.status] ?? updateRun.status)}
              </Badge>
              {updateRun.currentStep &&
                !isRunTerminal(
                  updateRun.status,
                  repo,
                  updateRun.kind,
                  updateRun.currentStep
                ) && (
                  <span>
                    {tx(
                      PHASE_LABELS[updateRun.currentStep] ??
                        updateRun.currentStep
                    )}
                    …
                  </span>
                )}
              {updateRun.currentStep === "merge_held" && (
                <span className="text-warning">
                  {tx("Auto-merge held back — the PR is open for review")}
                </span>
              )}
              {updateRun.kind === "security" && updateRun.triggerSource && (
                <Badge variant="outline">
                  {updateRun.triggerSource === "mcp"
                    ? tx("Via MCP ({key})", {
                        key: updateRun.triggerDetail?.apiKey ?? "—",
                      })
                    : updateRun.triggerSource === "auto"
                      ? tx("Auto-fix")
                      : tx("Manual")}
                </Badge>
              )}
            </CardDescription>
            {branchLink && (
              <CardAction className="flex flex-wrap gap-2 sm:justify-end">
                <Button asChild variant="outline" size="sm">
                  <a href={branchLink} target="_blank" rel="noreferrer">
                    {updateRun.prUrl ? tx("View PR") : tx("Create PR")}
                    <ExternalLink />
                  </a>
                </Button>
                {updateRun.prUrl &&
                  updateRun.status === "pr_opened" &&
                  !updateRun.merged && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setMergeError(null);
                        setMergeOpen(true);
                      }}
                    >
                      <GitMerge />
                      {hasDeployTarget(repo)
                        ? tx("Merge & deploy")
                        : tx("Merge")}
                    </Button>
                  )}
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {mergeError && !mergeOpen && <ErrorAlert>{mergeError}</ErrorAlert>}
            {alignNote && (
              <p className="text-sm text-muted-foreground">{alignNote}</p>
            )}
            {updateRun.status !== "failed" && (
              <Progress
                value={percentDone(runStepList)}
                aria-label={tx("Run progress")}
              />
            )}
            <ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {runStepList.map((step) => (
                <li
                  key={step.id}
                  className={cn(
                    "flex items-center gap-2",
                    step.state === "active"
                      ? "font-medium text-foreground"
                      : step.state === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  )}
                >
                  <StepIcon state={step.state} />
                  {step.label}
                  {step.state === "active" && updateRun.currentStep && (
                    <span className="font-normal text-muted-foreground">
                      {" — "}
                      {tx(
                        PHASE_LABELS[updateRun.currentStep] ??
                          updateRun.currentStep
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {updateRun.buildOk === false && updateRun.status !== "failed" && (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertDescription className="space-y-2 text-foreground">
                  {updateRun.logOutput?.includes("[versions]\nMISMATCH") &&
                  !updateRun.logOutput.includes("[versions fixed]") ? (
                    <div className="space-y-2">
                      <p>
                        {tx(
                          "Package versions do not match: packages released together (Payload, Next.js, React) are at different versions. The deploy would fail — the log below lists them."
                        )}
                      </p>
                      {!updateRun.merged && updateRun.branchName && (
                        <Button
                          size="sm"
                          onClick={alignVersions}
                          disabled={aligning}
                        >
                          {aligning ? <Spinner /> : <Wrench />}
                          {aligning
                            ? tx("Fixing…")
                            : tx("Fix versions on the branch")}
                        </Button>
                      )}
                    </div>
                  ) : updateRun.logOutput?.includes("[versions fixed]") ? (
                    <p>
                      {tx(
                        "Versions were aligned on the branch — the pull request has the fix; let its checks finish before merging."
                      )}
                    </p>
                  ) : (
                    <p>
                      {tx("The")}{" "}
                      {repo?.verifyMode === "build"
                        ? "build"
                        : repo?.verifyMode === "typecheck"
                          ? "typecheck"
                          : "check"}{" "}
                      {tx(
                        "failed on the update branch — review the pull request before merging. The log below shows what failed."
                      )}
                    </p>
                  )}
                  {branchLink && (
                    <Button asChild variant="outline" size="sm">
                      <a href={branchLink} target="_blank" rel="noreferrer">
                        {updateRun.prUrl
                          ? tx("Open pull request")
                          : tx("Open the branch on {host}", {
                              host: hostLabel(repo.githubUrl, repo.gitHost),
                            })}
                        <ExternalLink />
                      </a>
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {updateRun.kind === "security" && updateRun.securitySummary && (
              /* A green build proves it compiles. This says whether the
                 advisory is gone — the only claim worth making here. */
              <Alert
                variant={updateRun.securityVerified ? "success" : "warning"}
              >
                {updateRun.securityVerified ? (
                  <ShieldCheck />
                ) : (
                  <AlertTriangle />
                )}
                <AlertTitle>
                  {updateRun.securityVerified
                    ? tx("Verified by a second audit")
                    : tx("Not verified")}
                </AlertTitle>
                <AlertDescription>{updateRun.securitySummary}</AlertDescription>
              </Alert>
            )}
            {updateRun.logOutput && (
              /* The log is written after every phase, so this fills in while
                 the run is still going instead of only at the end. */
              <Collapsible
                open={logOpen}
                onOpenChange={setLogOpen}
                className="rounded-lg border"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Terminal className="size-4" />
                    {updateRun.status === "failed"
                      ? tx("Error log")
                      : tx("Live log")}
                    <ChevronDown className="ml-auto size-4 transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre
                    className={cn(
                      "scrollbar-slim max-h-72 overflow-auto whitespace-pre-wrap border-t bg-muted/40 px-3 py-2 font-mono text-xs",
                      updateRun.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    )}
                  >
                    {updateRun.logOutput}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>
      )}

      {(lastScan?.status === "success" || lastScan?.status === "failed") && (
        <Card className="gap-0 overflow-hidden pb-0">
          <CardHeader className="border-b pb-4 [.border-b]:pb-4">
            <CardTitle>{tx("Package findings")}</CardTitle>
            <CardDescription>
              {tx(
                "Every dependency in package.json against its latest release."
              )}
            </CardDescription>
          </CardHeader>
          {findings.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title={
                lastScan.status === "success"
                  ? tx(
                      "No dependencies in package.json or scan returned no results."
                    )
                  : tx("Scan failed. Check the error above.")
              }
              className="py-8 md:py-8"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-6">{tx("Package")}</TableHead>
                  <TableHead className="hidden @2xl/main:table-cell">
                    {tx("Current")}
                  </TableHead>
                  <TableHead className="hidden @2xl/main:table-cell">
                    {tx("Latest")}
                  </TableHead>
                  <TableHead className="hidden @2xl/main:table-cell">
                    {tx("Status")}
                  </TableHead>
                  <TableHead className="hidden pr-6 @2xl/main:table-cell">
                    {tx("Usage")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.map((f) => (
                  <TableRow key={f.packageName}>
                    <TableCell className="pr-6 pl-6 whitespace-normal @2xl/main:pr-2 @2xl/main:whitespace-nowrap">
                      <span className="font-mono break-all @2xl/main:break-normal">
                        {f.packageName}
                      </span>
                      {f.isDevDependency && (
                        <Badge variant="secondary" className="ml-2">
                          dev
                        </Badge>
                      )}
                      {/* Phones: versions, status and usage on one line. */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs @2xl/main:hidden">
                        <span className="tabular font-mono text-muted-foreground">
                          {f.currentVersion} → {f.latestVersion}
                        </span>
                        <Badge
                          variant={statusVariant(
                            f.currentVersion,
                            f.latestVersion
                          )}
                        >
                          {f.currentVersion === f.latestVersion
                            ? tx("up to date")
                            : tx("outdated")}
                        </Badge>
                        {f.unused && (
                          <Badge variant="destructive-soft">
                            {tx("unused")}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="tabular hidden font-mono text-xs @2xl/main:table-cell">
                      {f.currentVersion}
                    </TableCell>
                    <TableCell className="tabular hidden font-mono text-xs @2xl/main:table-cell">
                      {f.latestVersion}
                    </TableCell>
                    <TableCell className="hidden @2xl/main:table-cell">
                      <Badge
                        variant={statusVariant(
                          f.currentVersion,
                          f.latestVersion
                        )}
                      >
                        {f.currentVersion === f.latestVersion
                          ? tx("up to date")
                          : tx("outdated")}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden pr-6 @2xl/main:table-cell">
                      {f.unused ? (
                        <Badge variant="destructive-soft">{tx("unused")}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {tx("used")}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tx("Latest scan")}</CardTitle>
          <CardDescription>
            {lastScan ? (
              <span className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    lastScan.status === "success"
                      ? "success"
                      : lastScan.status === "failed"
                        ? "destructive-soft"
                        : "secondary"
                  }
                >
                  {lastScan.status === "running"
                    ? tx("Running…")
                    : lastScan.status === "pending"
                      ? tx("Pending…")
                      : lastScan.status === "success"
                        ? tx("done")
                        : tx(lastScan.status)}
                </Badge>
                {new Date(lastScan.startedAt).toLocaleString()}
                {" · "}
                <span className="font-mono">{branch}</span>
              </span>
            ) : (
              tx("Dependencies and advisories on the configured branch.")
            )}
          </CardDescription>
          <CardAction className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={startScan}
              disabled={scanning || isScanInProgress}
            >
              {scanning || isScanInProgress ? <Spinner /> : <RefreshCw />}
              {scanning
                ? tx("Starting…")
                : isScanInProgress
                  ? tx("Scan running…")
                  : tx("Scan now")}
            </Button>
            <Button
              size="sm"
              onClick={() => setUpdateOpen(true)}
              disabled={updating}
            >
              {tx("Update packages")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {lastScan ? (
            <>
              {(lastScan.status === "pending" ||
                lastScan.status === "running" ||
                lastScan.status === "success") && (
                <div className="space-y-3">
                  {lastScan.status !== "success" && (
                    <Progress
                      value={percentDone(scanSteps)}
                      aria-label={tx("Scan progress")}
                    />
                  )}
                  <ol className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    {scanSteps.map((step) => (
                      <li
                        key={step.id}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-3 py-2",
                          step.state === "active"
                            ? "border-primary/40 bg-primary/5 text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        <StepIcon state={step.state} />
                        <span className="truncate">
                          {tx(step.label)}
                          {step.progress}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {lastScan.status === "failed" && lastScan.errorMessage && (
                <ErrorAlert title={tx("Scan failed")}>
                  {lastScan.errorMessage}
                </ErrorAlert>
              )}
            </>
          ) : (
            <EmptyState
              icon={PackageSearch}
              title={tx("No scans yet")}
              description={tx(
                "No scans yet. Run a scan to see package status."
              )}
              className="py-6 md:py-6"
            />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="size-4 text-muted-foreground" />
              {tx("Repository")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">{tx("Branch")}</dt>
              <dd className="truncate font-mono">{branch}</dd>
              <dt className="text-muted-foreground">{tx("Root")}</dt>
              <dd className="truncate font-mono">{rootDisplay}</dd>
              <dt className="text-muted-foreground">{tx("Automatic scan")}</dt>
              <dd className="space-y-1">
                <span>{scheduleLabel(repo.scanSchedule)}</span>
                {repo.scanSchedule && scheduler && !scheduler.enabled && (
                  <span className="block text-xs text-warning">
                    {tx("scheduler not running on this instance")}
                  </span>
                )}
                {repo.scanSchedule && scheduler?.enabled && repo.nextScanAt && (
                  <span
                    className="block text-xs text-muted-foreground"
                    title={formatDateTime(repo.nextScanAt) ?? undefined}
                  >
                    next {formatRelative(repo.nextScanAt)}
                  </span>
                )}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="size-4 text-muted-foreground" />
              {tx("Deployment")}
            </CardTitle>
            <CardDescription className="truncate">
              {repo.liveUrl ? (
                <a
                  href={repo.liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {repo.liveUrl}
                </a>
              ) : (
                tx("No live URL set")
              )}
            </CardDescription>
            {repo.liveUrl && (
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkLive}
                  disabled={checkingLive}
                >
                  {checkingLive ? <Spinner /> : <RefreshCw />}
                  {checkingLive ? tx("Checking…") : tx("Check now")}
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            {(repo.branchHead || repo.deployedCommit) && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <GitBranch className="size-3.5" />
                <span className="font-mono">
                  {repo.defaultBranch ?? "main"}{" "}
                  {repo.branchHead?.slice(0, 7) ?? "?"}
                </span>
                <span>·</span>
                <Rocket className="size-3.5" />
                <span className="font-mono">
                  {tx("live")} {repo.deployedCommit?.slice(0, 7) ?? "?"}
                </span>
                {repo.branchHead && repo.deployedCommit && (
                  <Badge
                    variant={
                      repo.branchHead.startsWith(repo.deployedCommit) ||
                      repo.deployedCommit.startsWith(repo.branchHead)
                        ? "success"
                        : "warning"
                    }
                  >
                    {repo.branchHead.startsWith(repo.deployedCommit) ||
                    repo.deployedCommit.startsWith(repo.branchHead)
                      ? tx("live is up to date")
                      : tx("not deployed yet")}
                  </Badge>
                )}
                <span
                  title={tx(
                    "Both are watched every few minutes; a change scans again by itself."
                  )}
                >
                  · {tx("auto-scanned on change")}
                </span>
              </div>
            )}
            {repo.liveUrl ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={
                      repo.liveStatus === "up"
                        ? "success"
                        : repo.liveStatus === "down"
                          ? "destructive-soft"
                          : "outline"
                    }
                  >
                    {repo.liveStatus === "up"
                      ? tx("Up")
                      : repo.liveStatus === "down"
                        ? tx("Down")
                        : tx("Not checked yet")}
                    {repo.liveHttpStatus
                      ? ` · HTTP ${repo.liveHttpStatus}`
                      : ""}
                  </Badge>
                  {repo.liveCommit && (
                    <Badge variant="outline" className="font-mono">
                      commit {repo.liveCommit.slice(0, 12)}
                    </Badge>
                  )}
                  {repo.liveCheckedAt && (
                    <span
                      className="text-xs"
                      title={formatDateTime(repo.liveCheckedAt) ?? undefined}
                    >
                      {tx("checked {when}", {
                        when: formatRelative(repo.liveCheckedAt) ?? "",
                      })}
                    </span>
                  )}
                </div>
                {repo.liveStatus === "down" && repo.liveError && (
                  <p className="text-xs text-destructive">{repo.liveError}</p>
                )}
                {repo.liveStatus === "up" && !repo.liveCommit && (
                  <p className="text-xs">
                    {tx("The URL answers but reports no commit.")}
                    {repo.dokployApplicationId
                      ? tx(
                          " The deployed commit is taken from Dokploy instead (its last successful deploy)."
                        )
                      : tx(" Link the Dokploy application, or expose a ")}
                    {!repo.dokployApplicationId && (
                      <>
                        <code className="font-mono">commit</code>{" "}
                        {tx("field at")}{" "}
                        <code className="font-mono">/api/health</code>
                        {tx(
                          ", so a deploy can be confirmed instead of assumed."
                        )}
                      </>
                    )}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs">
                {tx(
                  "No live URL set. A triggered deploy only means the platform accepted the request — add the URL under Settings to see whether it reached the running app."
                )}
              </p>
            )}
            {(repo.liveUrl || repo.dokployApplicationId) && (
              <>
                <Separator />
                <div className="space-y-2">
                  {liveScanNote && (
                    <p className="text-xs text-muted-foreground">
                      {liveScanNote}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={startLiveScan}
                      disabled={liveScanning || isScanInProgress}
                    >
                      {liveScanning ? <Spinner /> : <ShieldCheck />}
                      {liveScanning
                        ? tx("Starting…")
                        : tx("Scan the deployed version")}
                    </Button>
                    {liveScan?.ref && (
                      <span className="font-mono text-xs">
                        commit {liveScan.ref.slice(0, 12)}
                      </span>
                    )}
                  </div>
                  {liveScan?.status === "pending" ||
                  liveScan?.status === "running" ? (
                    <p className="flex items-center gap-1.5 text-xs">
                      <Spinner className="size-3" />
                      {tx("Scanning the deployed commit…")}
                    </p>
                  ) : liveScan?.status === "failed" ? (
                    <p className="text-xs text-destructive">
                      {liveScan.errorMessage ?? tx("The live scan failed.")}
                    </p>
                  ) : liveScan?.status === "success" ? (
                    gap.fixedNotDeployed.length > 0 ? (
                      <Alert variant="warning">
                        <AlertTriangle />
                        <AlertTitle className="line-clamp-none">
                          {tx(
                            gap.fixedNotDeployed.length === 1
                              ? "{n} vulnerability is fixed on {branch} but still running live"
                              : "{n} vulnerabilities are fixed on {branch} but still running live",
                            { n: gap.fixedNotDeployed.length, branch }
                          )}
                        </AlertTitle>
                        <AlertDescription className="text-xs">
                          <p>{tx("The fix exists and has not shipped.")}</p>
                          <ul className="w-full space-y-1">
                            {gap.fixedNotDeployed.slice(0, 5).map((v) => (
                              <li
                                key={v.id}
                                className="flex min-w-0 items-center gap-1.5"
                              >
                                <SeverityBadge severity={v.severity} />
                                <span className="font-mono text-foreground">
                                  {v.packageName}
                                </span>
                                <span className="truncate">
                                  {v.ghsaId ?? v.cveId ?? v.title ?? ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {gap.fixedNotDeployed.length > 5 && (
                            <p>
                              {tx("and {n} more.", {
                                n: gap.fixedNotDeployed.length - 5,
                              })}
                            </p>
                          )}
                        </AlertDescription>
                      </Alert>
                    ) : liveVulns.length > 0 ? (
                      <p className="text-xs">
                        {tx(
                          liveVulns.length === 1
                            ? "{n} known vulnerability in the deployed version — still open on {branch} too, so there is nothing waiting to be deployed."
                            : "{n} known vulnerabilities in the deployed version — all of them still open on {branch} too, so there is nothing waiting to be deployed.",
                          { n: liveVulns.length, branch }
                        )}
                      </p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs text-success">
                        <ShieldCheck className="size-3.5" />
                        {tx(
                          "No known vulnerabilities in the deployed version."
                        )}
                      </p>
                    )
                  ) : (
                    <p className="text-xs">
                      {tx(
                        "Scans the exact commit the deployment reports, so a CVE fixed in the code can be told apart from one fixed in production."
                      )}
                    </p>
                  )}
                  {liveScan?.status === "success" &&
                    gap.newSinceDeploy.length > 0 && (
                      <p className="text-xs">
                        {tx(
                          gap.newSinceDeploy.length === 1
                            ? "{n} further vulnerability affects only {branch} — introduced after this commit was built."
                            : "{n} further vulnerabilities affect only {branch} — introduced after this commit was built.",
                          { n: gap.newSinceDeploy.length, branch }
                        )}
                      </p>
                    )}
                </div>
              </>
            )}
            {lastDeploy && (
              <>
                <Separator />
                <div className="space-y-1 text-xs">
                  <p className="flex items-center gap-1.5">
                    <Rocket className="size-3.5" />
                    {tx("Last deploy")}{" "}
                    <span
                      title={
                        formatDateTime(lastDeploy.triggeredAt) ?? undefined
                      }
                    >
                      {formatRelative(lastDeploy.triggeredAt)}
                    </span>
                    {lastDeploy.status === "failed"
                      ? tx(" · rejected by Dokploy")
                      : tx(" · accepted by Dokploy")}
                  </p>
                  {lastDeploy.errorMessage && (
                    <p className="text-destructive">
                      {lastDeploy.errorMessage}
                    </p>
                  )}
                  {watchingDeploy ? (
                    <p className="flex items-center gap-1.5">
                      <Spinner className="size-3" />
                      {tx(
                        "Watching the deploy — Dokploy's build state and the live URL — for up to 12 minutes…"
                      )}
                    </p>
                  ) : (
                    lastDeploy.liveDetail && (
                      <p
                        className={
                          lastDeploy.liveOk ? "text-success" : "text-warning"
                        }
                      >
                        {lastDeploy.liveDetail}
                      </p>
                    )
                  )}
                  {lastDeploy.guard &&
                    lastDeploy.guard !== "healthy" &&
                    lastDeploy.guard !== "broken" &&
                    lastDeploy.guard !== "build_failed" && (
                      <p
                        className={
                          lastDeploy.guard === "rolled_back"
                            ? "text-success"
                            : "text-destructive"
                        }
                      >
                        {lastDeploy.guard === "rolled_back"
                          ? tx("Rolled back. ")
                          : tx("Rollback failed. ")}
                        {lastDeploy.guardDetail}
                      </p>
                    )}
                  {rollbackResult && (
                    <p
                      className={
                        rollbackResult.ok ? "text-success" : "text-destructive"
                      }
                    >
                      {rollbackResult.detail}
                    </p>
                  )}
                  {!watchingDeploy &&
                    lastDeploy.status === "succeeded" &&
                    lastDeploy.guard !== "rolled_back" && (
                      <Button
                        variant={
                          lastDeploy.guard === "broken" ||
                          lastDeploy.guard === "error_spike" ||
                          lastDeploy.guard === "build_failed" ||
                          lastDeploy.guard === "rollback_failed"
                            ? "destructive"
                            : "outline"
                        }
                        size="xs"
                        className="mt-1"
                        onClick={() => {
                          setRollbackResult(null);
                          setRollbackOpen(true);
                        }}
                      >
                        <Undo2 />
                        {tx("Roll back this deploy")}
                      </Button>
                    )}
                </div>
              </>
            )}
            {liveCheckError && <ErrorAlert>{liveCheckError}</ErrorAlert>}
          </CardContent>
        </Card>
      </div>

      <MigrationsCard repoId={repo.id} check={repo.migrationCheck} />

      <BranchesCard
        repoId={repo.id}
        githubUrl={repo.githubUrl}
        gitHost={repo.gitHost}
      />

      {repo.liveUrl && <IncidentsCard repoId={repo.id} />}

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="border-b pb-4 [.border-b]:pb-4">
          <CardTitle className="flex items-center gap-2">
            <Radar className="size-4 text-muted-foreground" />
            {tx("Live application")}
          </CardTitle>
          <CardDescription>
            {tx(
              "Findings on the running application: Nuclei, Uptime Kuma and — through the linked Dokploy application — its container's image CVEs and memory."
            )}
          </CardDescription>
          {repo.serverId && (
            <CardAction>
              <Button asChild variant="outline" size="sm">
                <Link
                  to="/servers/$serverId"
                  params={{ serverId: repo.serverId }}
                >
                  {tx("Open server")}
                </Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        {!repo.serverId ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">
            {tx(
              "Not monitored: assign this application to a server (Settings → Runs on server) so its live URL is scanned with Nuclei and matched to Uptime Kuma."
            )}
          </p>
        ) : liveFindings === null ? (
          <div className="p-6">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : liveFindings.length === 0 ? (
          <p className="flex items-center gap-2 px-6 py-4 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-success" />
            {tx("No open findings on the live application.")}
          </p>
        ) : (
          <FindingsTable findings={liveFindings} />
        )}
      </Card>

      {/* Checks beyond security holes: useful, but not where anyone has to
          start — one click away instead of a page of cards. */}
      <Collapsible className="space-y-6">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg border px-5 py-3 text-left hover:bg-muted/40">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="font-medium">{tx("More checks")}</span>
          <span className="truncate text-sm text-muted-foreground">
            {tx(
              "Setup, site security, performance, user journeys and error logs"
            )}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-6">
          {(repo.liveChecks || repo.configCheck || repo.liveUrl) && (
            <ConfigCard repo={repo} />
          )}
          {repo.liveUrl && (
            <SiteProbeCard repoId={repo.id} initial={repo.siteProbe} />
          )}
          {repo.liveUrl && <PerfCard repoId={repo.id} />}
          {repo.liveUrl && <ChecksCard repoId={repo.id} />}
          {repo.dokployAppName && (
            <LogErrorsCard source={{ repositoryId: repo.id }} />
          )}
        </CollapsibleContent>
      </Collapsible>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tx("Repository settings")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Branch and root directory used when scanning for package.json."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="settings-branch">{tx("Branch")}</Label>
                <BranchSelect
                  id="settings-branch"
                  githubUrl={repo.githubUrl}
                  value={editBranch}
                  onChange={setEditBranch}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settings-root">{tx("Root directory")}</Label>
                <Input
                  id="settings-root"
                  value={editRoot}
                  onChange={(e) => setEditRoot(e.target.value)}
                  placeholder={tx("e.g. apps/web — leave empty for repo root")}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-dokploy">
                {tx("Dokploy application")}
              </Label>
              {dokployAppsError ? (
                <>
                  <Input
                    id="settings-dokploy"
                    value={editDokployAppId}
                    onChange={(e) => setEditDokployAppId(e.target.value)}
                    placeholder={tx("application id")}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    {dokployAppsError}{" "}
                    {tx("— set the Dokploy URL and API key under")}{" "}
                    <Link
                      to="/settings"
                      className="text-primary hover:underline"
                    >
                      {tx("Settings")}
                    </Link>{" "}
                    {tx("to pick the application from a list.")}
                  </p>
                </>
              ) : (
                <>
                  <Select
                    value={editDokployAppId || DOKPLOY_NONE}
                    onValueChange={(v) =>
                      setEditDokployAppId(v === DOKPLOY_NONE ? "" : v)
                    }
                    disabled={dokployApps === null}
                  >
                    <SelectTrigger id="settings-dokploy" className="w-full">
                      <SelectValue
                        placeholder={
                          dokployApps === null
                            ? tx("Loading…")
                            : tx("Not linked")
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DOKPLOY_NONE}>
                        {tx("Not linked")}
                      </SelectItem>
                      {(dokployApps ?? []).map((a) => (
                        <SelectItem
                          key={a.applicationId}
                          value={a.applicationId}
                        >
                          {a.project}
                          {a.environment ? ` / ${a.environment}` : ""} —{" "}
                          {a.name}
                          {a.kind === "compose" ? tx(" (compose)") : ""}
                          {a.githubRepo &&
                          repoSlug(repo?.githubUrl) === a.githubRepo
                            ? tx(" (this repository)")
                            : ""}
                        </SelectItem>
                      ))}
                      {editDokployAppId &&
                        dokployApps &&
                        !dokployApps.some(
                          (a) => a.applicationId === editDokployAppId
                        ) && (
                          <SelectItem value={editDokployAppId}>
                            {editDokployAppId} {tx("(not found in Dokploy)")}
                          </SelectItem>
                        )}
                    </SelectContent>
                  </Select>
                  {dokployApps && (
                    <p className="text-xs text-muted-foreground">
                      {dokployApps.length} application
                      {dokployApps.length === 1 ? "" : "s"}{" "}
                      {tx("and compose stacks")}
                      {dokployProjects != null
                        ? ` in ${dokployProjects} Dokploy project${dokployProjects === 1 ? "" : "s"}`
                        : ""}{" "}
                      {tx(
                        "visible to the API key. Missing one? Projects in another Dokploy organization need a key from that organization."
                      )}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {tx(
                      "Linked automatically when one Dokploy application deploys this repository. Used for “Merge & deploy”, for auto-deploy, and to match the running container — its memory and image CVEs show up on this page."
                    )}
                  </p>
                </>
              )}
            </div>

            {coolifyApps !== undefined && (
              <div className="grid gap-2">
                <Label htmlFor="settings-coolify">
                  {tx("Coolify application")}
                </Label>
                <Select
                  value={editCoolifyUuid || DOKPLOY_NONE}
                  onValueChange={(v) =>
                    setEditCoolifyUuid(v === DOKPLOY_NONE ? "" : v)
                  }
                  disabled={coolifyApps === null}
                >
                  <SelectTrigger id="settings-coolify" className="w-full">
                    <SelectValue
                      placeholder={
                        coolifyApps === null ? tx("Loading…") : tx("Not linked")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DOKPLOY_NONE}>
                      {tx("Not linked")}
                    </SelectItem>
                    {(coolifyApps ?? []).map((a) => (
                      <SelectItem key={a.uuid} value={a.uuid}>
                        {a.name}
                        {a.branch ? ` (${a.branch})` : ""}
                        {a.githubRepo &&
                        repoSlug(repo?.githubUrl) === a.githubRepo
                          ? tx(" (this repository)")
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {tx(
                    "For sites on Coolify: deploys, rollback, self-healing. Linked automatically when one Coolify application deploys this repository. Dokploy wins when both are set."
                  )}
                </p>
              </div>
            )}

            {(editStack || (stackApps?.length ?? 0) > 0) && (
              <div className="grid gap-2">
                <Label htmlFor="settings-stack">
                  {tx("Komodo or Portainer stack")}
                </Label>
                <Select
                  value={editStack || DOKPLOY_NONE}
                  onValueChange={(v) =>
                    setEditStack(v === DOKPLOY_NONE ? "" : v)
                  }
                  disabled={stackApps === null}
                >
                  <SelectTrigger id="settings-stack" className="w-full">
                    <SelectValue
                      placeholder={
                        stackApps === null ? tx("Loading…") : tx("Not linked")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DOKPLOY_NONE}>
                      {tx("Not linked")}
                    </SelectItem>
                    {editStack &&
                      !stackApps?.some(
                        (a) => `${a.platform}|${a.id}` === editStack
                      ) && (
                        <SelectItem value={editStack}>{editStack}</SelectItem>
                      )}
                    {(stackApps ?? []).map((a) => (
                      <SelectItem
                        key={`${a.platform}|${a.id}`}
                        value={`${a.platform}|${a.id}`}
                      >
                        {a.platform === "komodo" ? "Komodo" : "Portainer"}:{" "}
                        {a.name}
                        {a.branch ? ` (${a.branch})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {tx(
                    "For sites in a Komodo or Portainer stack from Git: deploys after a merge, self-healing, redeploy. Linked automatically when one stack deploys this repository. Dokploy and Coolify win when set."
                  )}
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="settings-live-url">{tx("Live URL")}</Label>
                {repo?.dokployApplicationId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={loadDokployDomains}
                    disabled={loadingDomains}
                  >
                    {loadingDomains && <Spinner />}
                    {loadingDomains ? tx("Loading…") : tx("Load from Dokploy")}
                  </Button>
                )}
              </div>
              <Input
                id="settings-live-url"
                value={editLiveUrl}
                onChange={(e) => setEditLiveUrl(e.target.value)}
                placeholder="https://app.example.com/api/health"
                className="font-mono"
              />
              {domainSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {domainSuggestions.map((url) => (
                    <Badge key={url} variant="outline" asChild>
                      <button
                        type="button"
                        onClick={() => setEditLiveUrl(url)}
                        className="cursor-pointer font-mono text-muted-foreground hover:border-primary hover:text-primary"
                      >
                        {url}
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {tx(
                  "Where this repo is deployed. Prefer an endpoint that returns a JSON"
                )}{" "}
                <code className="font-mono">commit</code>{" "}
                {tx(
                  "field: then a deploy is confirmed by the commit changing, not by the page merely loading."
                )}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-schedule">{tx("Scheduled scan")}</Label>
              <Select
                value={editSchedule || SCHEDULE_OFF}
                onValueChange={(v) =>
                  setEditSchedule(v === SCHEDULE_OFF ? "" : v)
                }
              >
                <SelectTrigger id="settings-schedule" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_OPTIONS.map((o) => (
                    <SelectItem
                      key={o.value || SCHEDULE_OFF}
                      value={o.value || SCHEDULE_OFF}
                    >
                      {tx(o.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editSchedule && scheduler && !scheduler.enabled && (
                <p className="text-xs text-warning">
                  {tx("This API instance runs without")}{" "}
                  <code className="font-mono">ENABLE_SCHEDULER=true</code>
                  {tx(
                    ", so scheduled scans will not start. The setting is saved either way."
                  )}
                </p>
              )}
              {editSchedule && editLiveUrl.trim() && (
                <p className="text-xs text-muted-foreground">
                  {tx(
                    "Each scheduled scan is followed by a scan of the commit the live URL reports — the version that is actually deployed."
                  )}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-client">{tx("Client")}</Label>
              <Select
                value={editClientId || SERVER_NONE}
                onValueChange={(v) =>
                  setEditClientId(v === SERVER_NONE ? "" : v)
                }
              >
                <SelectTrigger id="settings-client" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SERVER_NONE}>{tx("No client")}</SelectItem>
                  {clientOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {tx(
                  "The customer this site belongs to — for the client view and the monthly report."
                )}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-server">{tx("Runs on server")}</Label>
              <Select
                value={editServerId || SERVER_NONE}
                onValueChange={(v) =>
                  setEditServerId(v === SERVER_NONE ? "" : v)
                }
              >
                <SelectTrigger id="settings-server" className="w-full">
                  <SelectValue placeholder={tx("Loading…")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SERVER_NONE}>
                    {tx("Not assigned")}
                  </SelectItem>
                  {(servers ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {tx(
                  "The server's Nuclei scans then include this live URL, and its findings and Uptime Kuma monitors show up here."
                )}
              </p>
            </div>

            <Separator />

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">
                  {tx("Autonomous security pipeline")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tx(
                    "Each step is off by default. They escalate: merge needs auto-fix; deploy needs merge."
                  )}
                </p>
              </div>
              <div className="divide-y rounded-lg border">
                <div className="flex items-center justify-between gap-4 p-3">
                  <Label
                    htmlFor="settings-auto-fix"
                    className="font-normal leading-snug"
                  >
                    {tx(
                      "Auto-fix critical/high CVEs (open a PR automatically)"
                    )}
                  </Label>
                  <Switch
                    id="settings-auto-fix"
                    checked={editAutoFix}
                    onCheckedChange={(checked) => {
                      setEditAutoFix(checked);
                      if (!checked) {
                        setEditAutoFixForce(false);
                        setEditAutoMerge(false);
                        setEditAutoDeploy(false);
                      }
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 p-3 pl-8">
                  <Label
                    htmlFor="settings-auto-fix-force"
                    className="font-normal leading-snug"
                  >
                    {tx("Allow breaking fixes (")}
                    <code className="font-mono text-xs">
                      npm audit fix --force
                    </code>
                    )
                  </Label>
                  <Switch
                    id="settings-auto-fix-force"
                    checked={editAutoFixForce}
                    disabled={!editAutoFix}
                    onCheckedChange={setEditAutoFixForce}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 p-3">
                  <Label
                    htmlFor="settings-auto-merge"
                    className="font-normal leading-snug"
                  >
                    {tx("Auto-merge when the check and CI pass")}
                  </Label>
                  <Switch
                    id="settings-auto-merge"
                    checked={editAutoMerge}
                    disabled={!editAutoFix}
                    onCheckedChange={(checked) => {
                      setEditAutoMerge(checked);
                      if (!checked) setEditAutoDeploy(false);
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 p-3">
                  <Label
                    htmlFor="settings-auto-deploy"
                    className="font-normal leading-snug"
                  >
                    {tx("Auto-deploy via Dokploy after merge")}
                  </Label>
                  <Switch
                    id="settings-auto-deploy"
                    checked={editAutoDeploy}
                    disabled={!editAutoMerge}
                    onCheckedChange={setEditAutoDeploy}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 p-3">
                  <Label
                    htmlFor="settings-auto-rollback"
                    className="flex-col items-start gap-1 font-normal leading-snug"
                  >
                    {tx(
                      "Roll back automatically when a deploy breaks the site"
                    )}
                    <span className="text-xs text-muted-foreground">
                      {tx(
                        "Watches the live URL after every deploy. Dokploy's rollback when it kept the previous image, and a revert of the merge on"
                      )}{" "}
                      {editBranch || "main"}.
                    </span>
                  </Label>
                  <Switch
                    id="settings-auto-rollback"
                    checked={editAutoRollback}
                    disabled={!editLiveUrl.trim()}
                    onCheckedChange={setEditAutoRollback}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 p-3">
                  <Label
                    htmlFor="settings-auto-heal"
                    className="flex-col items-start gap-1 font-normal leading-snug"
                  >
                    {tx("Restart automatically when the site stays down")}
                    <span className="text-xs text-muted-foreground">
                      {tx(
                        "After 5 minutes down, the app is restarted through Dokploy — at most 3 times a day. If that does not help, you get a message."
                      )}
                    </span>
                  </Label>
                  <Switch
                    id="settings-auto-heal"
                    checked={editAutoHeal}
                    disabled={
                      !editLiveUrl.trim() ||
                      (!editDokployAppId.trim() && !editCoolifyUuid)
                    }
                    onCheckedChange={setEditAutoHeal}
                  />
                </div>
              </div>
              {!editLiveUrl.trim() && (
                <p className="-mt-2 text-xs text-muted-foreground">
                  {tx(
                    "Automatic rollback needs a live URL — without one nothing can tell that a deploy broke the site."
                  )}
                </p>
              )}
              <div className="grid gap-2">
                <Label htmlFor="settings-verify">
                  {tx("Check before the PR")}
                </Label>
                <Select
                  value={mode?.cloud ? "none" : editVerifyMode}
                  onValueChange={(v) => setEditVerifyMode(v as VerifyMode)}
                  disabled={mode?.cloud}
                >
                  <SelectTrigger id="settings-verify" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="typecheck">
                      {tx("Typecheck (recommended)")}
                    </SelectItem>
                    <SelectItem value="build">
                      {tx("Full build + tests")}
                    </SelectItem>
                    <SelectItem value="none">
                      {tx("None — the repository's CI decides")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {mode?.cloud
                    ? tx(
                        "On Moatline Cloud no code from your repository runs on our servers: your repository's CI checks every fix. Auto-merge waits for it to pass."
                      )
                    : editVerifyMode === "typecheck"
                      ? tx(
                          "tsc --noEmit: catches what an update breaks in the code, needs no database and little memory."
                        )
                      : editVerifyMode === "build"
                        ? tx(
                            "Only for apps that build without a database — Payload and Next.js pages that render from their database fail here, because the check never gets credentials. Runs at low priority, one at a time."
                          )
                        : tx(
                            "Nothing runs on this server. Auto-merge then waits for a green GitHub CI; a repository without CI is never merged automatically."
                          )}
                </p>
                {editVerifyMode === "none" && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">
                      {tx("Workflow for your build server")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tx("Save as")}{" "}
                      <code className="font-mono">
                        .github/workflows/build-check.yml
                      </code>
                      {tx(
                        ". It runs on the self-hosted runner (server → Setup → build server) with an empty database of its own — never the real one."
                      )}
                    </p>
                    <Select
                      value={wfDatabase}
                      onValueChange={(v) => setWfDatabase(v as BuildDatabase)}
                    >
                      <SelectTrigger
                        aria-label={tx("Database for the build")}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="postgres">
                          {tx("PostgreSQL (Payload migrations run first)")}
                        </SelectItem>
                        <SelectItem value="mongo">{tx("MongoDB")}</SelectItem>
                        <SelectItem value="none">
                          {tx("No database")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <CodeBlock
                      text={buildWorkflow({
                        database: wfDatabase,
                        manager: repo?.packageManager ?? "pnpm",
                        node: "22",
                      })}
                      label="build-check.yml"
                    />
                  </div>
                )}
              </div>
              {editAutoDeploy && !editDokployAppId && !editCoolifyUuid && (
                <p className="text-xs text-warning">
                  {tx(
                    "Auto-deploy needs a Dokploy or Coolify application (above)."
                  )}
                </p>
              )}
            </div>
            {settingsError && <ErrorAlert>{settingsError}</ErrorAlert>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              {tx("Cancel")}
            </Button>
            <Button onClick={saveSettings} disabled={savingSettings}>
              {savingSettings && <Spinner />}
              {savingSettings ? tx("Saving…") : tx("Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("Start update")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Bumps outdated packages on a new branch, checks it and opens a pull request."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="update-target">{tx("Which updates")}</Label>
            <Select
              value={updateTarget}
              onValueChange={(v) => setUpdateTarget(v as "minor" | "latest")}
            >
              <SelectTrigger id="update-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minor">
                  {tx("Minor & patch (recommended)")}
                </SelectItem>
                <SelectItem value="latest">
                  {tx("Latest, including major versions")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {updateTarget === "minor"
                ? tx(
                    "Newest release within each major version — usually deploys without code changes."
                  )
                : tx(
                    "Major versions can break the app; read the changelogs before merging."
                  )}
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Checkbox
              id="update-with-ai"
              checked={withAi}
              onCheckedChange={(checked) => setWithAi(checked === true)}
            />
            <Label htmlFor="update-with-ai" className="font-normal">
              {tx("Use AI to fix breaking changes")}
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateOpen(false)}>
              {tx("Cancel")}
            </Button>
            <Button onClick={startUpdate} disabled={updating}>
              {updating && <Spinner />}
              {tx("Start update")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasDeployTarget(repo)
                ? tx("Merge and deploy?")
                : tx("Merge the pull request?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tx("Squash-merges the pull request into")}{" "}
              <span className="font-mono">{repo.defaultBranch ?? "main"}</span>
              {repo.dokployApplicationId
                ? tx(
                    " and deploys it with Dokploy (if Dokploy deploys on push, its webhook does it and nothing is deployed twice)."
                  )
                : tx(
                    ". No Dokploy application is linked, so nothing is deployed."
                  )}{" "}
              {tx("Branch protection on {host} still applies.", {
                host: hostLabel(repo?.githubUrl ?? "", repo?.gitHost),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {updateRun?.buildOk === false && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertDescription className="text-foreground">
                {tx(
                  "The check failed on this branch. Merging anyway can break the deploy — Dokploy then keeps the previous version running."
                )}
              </AlertDescription>
            </Alert>
          )}
          {mergeError && <ErrorAlert>{mergeError}</ErrorAlert>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>
              {tx("Cancel")}
            </AlertDialogCancel>
            <Button
              variant={updateRun?.buildOk === false ? "destructive" : "default"}
              onClick={confirmMerge}
              disabled={merging}
            >
              {merging ? <Spinner /> : <GitMerge />}
              {merging
                ? tx("Merging…")
                : hasDeployTarget(repo)
                  ? tx("Merge & deploy")
                  : tx("Merge")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tx("Roll back the last deploy?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tx(
                "Puts the previous version back: Dokploy's rollback when it kept the previous image, and a revert commit of the merge on"
              )}{" "}
              <span className="font-mono">{repo.defaultBranch ?? "main"}</span>{" "}
              {tx(
                "(only while nothing was committed on top). Without a Dokploy rollback the revert is deployed — that is a normal build."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>
              {tx("Cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={confirmRollback}
              disabled={rollingBack}
            >
              {rollingBack ? <Spinner /> : <Undo2 />}
              {rollingBack ? tx("Rolling back…") : tx("Roll back")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tx("Delete repository")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tx(
                "Remove this repo and all its scan data? This cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {tx("Cancel")}
            </AlertDialogCancel>
            {/* A plain Button, not AlertDialogAction: that one closes the
                dialog on click, before the delete has actually succeeded. */}
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting && <Spinner />}
              {deleting ? tx("Deleting…") : tx("Delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
