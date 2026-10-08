import { LOGIN_DISABLED } from "./auth-mode";
import { tx } from "./i18n";

const base = import.meta.env.VITE_API_URL ?? "";

const useDemoOrg = LOGIN_DISABLED;

export type VulnSeverity = "critical" | "high" | "moderate" | "low" | "info";

export type SeverityCounts = {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  total: number;
};

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingCounts = Record<FindingSeverity | "total", number>;

export type DashboardData = {
  /** Exposure: per repo the deployed version when known, else the branch. */
  totals: SeverityCounts;
  branchTotals: SeverityCounts;
  liveCoverage: { live: number; total: number };
  /** Advisories fixed on a branch whose fix is not deployed yet. */
  fixedNotDeployed: number;
  repos: Array<{
    repositoryId: string;
    name: string;
    githubUrl: string;
    autoFixCritical: boolean;
    autoDeploy: boolean;
    lastScanAt: string | null;
    lastScanId: string | null;
    scanned: boolean;
    counts: SeverityCounts;
    exposureSource: "live" | "branch";
    branchCounts: SeverityCounts;
    liveCounts: SeverityCounts | null;
    liveScanAt: string | null;
    liveCommit: string | null;
    liveUrl: string | null;
    liveStatus: "up" | "down" | null;
    fixedNotDeployed: number;
    /** Open Nuclei / Uptime Kuma findings on the live application. */
    appFindings: Partial<FindingCounts> & { total: number };
    serverId: string | null;
  }>;
  servers: {
    total: number;
    reporting: number;
    stale: number;
    never: number;
    findings: FindingCounts;
  };
};

export type ImageStatus = {
  image: string;
  containers: string[];
  created: string | null;
  verdict:
    | { status: "unmaintained"; since: string }
    | { status: "outdated"; tagUpdated: string | null }
    | { status: "current" }
    | { status: "unknown" };
};

export type MissingServer = {
  dokployServerId: string | null;
  name: string;
  address: string | null;
};

/** One kind of error an app logged, with an hourly series. */
export type LogErrorSummary = {
  id: string;
  app: string;
  sample: string;
  total: number;
  firstSeen: string;
  lastSeen: string;
  recent: number;
  hourly: number[];
};

export type ProvisionOptions = {
  templates: string[];
  owners: string[];
  githubError: string | null;
  dokploy:
    | {
        ok: true;
        environments: Array<{
          id: string;
          project: string;
          name: string;
          legacy: boolean;
        }>;
        servers: Array<{ id: string; name: string; ip: string | null }>;
        githubProviders: Array<{ id: string; name: string }>;
        destinations: Array<{ id: string; name: string }>;
      }
    | { ok: false; error: string };
};

export type TemplateEnvKey = {
  key: string;
  example: string;
  auto: "database" | "secret" | "url" | null;
};

export type ProvisionInput = {
  name: string;
  clientId: string | null;
  source:
    | {
        kind: "template";
        template: string;
        owner: string;
        repo: string;
        private: boolean;
      }
    | { kind: "existing"; fullName: string };
  branch: string;
  environment: { id: string; legacy: boolean } | { newProject: string };
  serverId: string | null;
  githubProviderId: string;
  database: "postgres" | "mongo" | "none";
  backupDestinationId: string | null;
  domain: string;
  env: Record<string, string>;
  envKeys: Array<{ key: string; example: string }>;
  autoHeal: boolean;
};

export type ProvisionRun = {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
  steps: Array<{
    key: string;
    label: string;
    status: "pending" | "running" | "done" | "skipped" | "failed";
    detail?: string;
  }>;
  repositoryId: string | null;
  createdAt: string;
};

export type UpdateStatus =
  | { hidden: true }
  | {
      hidden?: false;
      current: string;
      latest: {
        version: string;
        url: string;
        notes: string;
        publishedAt: string | null;
      } | null;
      available: boolean;
      mode: "button" | "compose" | "dokploy" | "coolify" | "unknown";
      hint?: "no-socket-permission" | "self-update-off" | null;
    };

export type MaintenanceWindow = {
  id: string;
  scope: "organization" | "server" | "repository";
  targetId: string | null;
  reason: string | null;
  startsAt: string;
  endsAt: string;
};

export type CronCheck = {
  id: string;
  name: string;
  token: string;
  periodSeconds: number;
  graceSeconds: number;
  status: "new" | "up" | "down";
  lastPingAt: string | null;
  downSince: string | null;
  pings: Array<{ at: string; kind: "ok" | "fail" | "start"; ms?: number }>;
};

export type PlatformWatch = {
  checkedAt: string;
  platforms: Array<{
    platform: string;
    label: string;
    version: string | null;
    latest: string | null;
    affected: Array<{
      id: string;
      cve: string | null;
      summary: string;
      severity: string;
      url: string;
      patched: string | null;
    }>;
  }>;
};

export type MigrationIssue = {
  kind: string;
  severity: "high" | "medium";
  title: string;
  detail: string;
  file?: string;
  line?: number;
};

export type MigrationCheck = {
  checkedAt: string;
  framework: "payload" | "prisma" | "drizzle" | null;
  head: string | null;
  setup: MigrationIssue[];
  branch: { from: string; to: string; issues: MigrationIssue[] } | null;
  prs: Array<{
    number: number;
    url: string;
    title: string;
    headSha: string | null;
    issues: MigrationIssue[];
  }>;
};

export type PublicStatus = {
  title: string;
  description: string | null;
  overall: "up" | "partial" | "down" | "maintenance" | "unknown";
  components: Array<{
    name: string;
    state: "up" | "down" | "maintenance" | "unknown";
    uptime90: number;
    days: Array<{ date: string; downMinutes: number }>;
  }>;
  incidents: Array<{
    component: string;
    startedAt: string;
    resolvedAt: string | null;
  }>;
  updatedAt: string;
};

export type StatusPage = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  components: Array<{ repositoryId: string; name: string }>;
  published: boolean;
};

export type StatusPageInput = Omit<StatusPage, "id">;

export type PlanId = "solo" | "team" | "agency";

export type BillingPlan = {
  id: PlanId;
  name: string;
  eur: number;
  servers: number;
  /** null: no limit. */
  repositories: number | null;
};

/** Figures across all organizations, for the instance's operators. */
export type OperatorStats = {
  users: {
    total: number;
    verified: number;
    new7d: number;
    new30d: number;
    active7d: number;
    active30d: number;
  };
  signupsByWeek: Array<{ week: string; count: number }>;
  organizations: { total: number; withServer: number; withRepository: number };
  servers: { total: number; reporting24h: number };
  repositories: number;
  billing: {
    paying: number;
    trialing: number;
    pastDue: number;
    canceled: number;
    mrrEur: number;
    byPlan: Record<string, number>;
  };
  recent: Array<{
    email: string;
    name: string | null;
    createdAt: string;
    verified: boolean;
    lastActiveAt: string | null;
    organizations: string[];
    servers: number;
    repositories: number;
    plan: string | null;
  }>;
};

export type BillingState = {
  enabled: boolean;
  organizationId: string;
  plan: "selfhosted" | "active" | "free" | "none";
  /** The plan paid for. */
  tier: PlanId | null;
  status: string | null;
  usage: { servers: number; repositories: number };
  periodEndsAt: string | null;
  scheduledChange: { action: string; effectiveAt: string | null } | null;
  plans: BillingPlan[];
  /** Stripe's test mode: no real money moves. */
  test: boolean;
};

export type CheckStep = {
  method: "GET" | "POST" | "PUT" | "HEAD";
  path: string;
  body?: string;
  contentType?: "json" | "form" | "none";
  expectStatus?: number;
  expectText?: string;
  maxMs?: number;
};

export type CheckStepResult = {
  step: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  error?: string;
};

export type SyntheticCheck = {
  id: string;
  name: string;
  steps: CheckStep[];
  hasSecrets: boolean;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastResult: CheckStepResult[] | null;
  failures: number;
};

export type CheckInput = {
  name: string;
  steps: CheckStep[];
  secrets?: Record<string, string> | null;
  intervalMinutes?: number;
  enabled?: boolean;
};

export type IncidentStep = { at: string; text: string };

export type RepoIncidents = {
  uptime30: number;
  uptime90: number;
  incidents: Array<{
    id: string;
    startedAt: string;
    resolvedAt: string | null;
    cause: string | null;
    timeline: IncidentStep[];
    healAttempts: number;
    kind?: "site_down" | "alert" | "check";
  }>;
  /** Where the site is checked from, with each one's latest result. */
  locations?: Array<{
    name: string;
    ok: boolean;
    httpStatus: number | null;
    error: string | null;
    checkedAt: string;
  }>;
};

export type OpenIncident = {
  id: string;
  repositoryId: string;
  name: string;
  startedAt: string;
  cause: string | null;
  healAttempts: number;
};

export type VersionLag = "current" | "patch" | "minor" | "major" | "unknown";
export type StackPackage = "payload" | "next" | "react";

/** Payload / Next.js / React / Node across all repositories. */
export type VersionOverview = {
  latest: Record<StackPackage, string | null>;
  node: { recommended: number; eol: Record<string, string> };
  repos: Array<{
    id: string;
    name: string;
    githubUrl: string;
    client: { id: string; name: string | null } | null;
    packages: Partial<
      Record<
        StackPackage,
        {
          version: string | null;
          declared: string | null;
          fromLockfile: boolean;
          lag: VersionLag;
        }
      >
    >;
    node: {
      version: string;
      source: "Dockerfile" | ".nvmrc" | "engines";
      support: "eol" | "soon" | "ok" | "unknown";
    } | null;
    scannedAt: string | null;
    updating: boolean;
  }>;
};

export type DockerDiskPart = { sizeBytes: number; reclaimableBytes: number };

export type FindingSource =
  | "host"
  | "trivy"
  | "crowdsec"
  | "nuclei"
  | "kuma"
  | "wazuh"
  | "heartbeat"
  | "network"
  | "security"
  | "provider"
  | "dokploy"
  | "registry"
  | "coolify"
  | "platform";

export type ServerFinding = {
  id: string;
  serverId: string;
  repositoryId: string | null;
  source: FindingSource;
  fingerprint: string;
  severity: FindingSeverity;
  title: string;
  detail: string | null;
  target: string | null;
  reference: string | null;
  fixAvailable: boolean | null;
  /** The server's automation fixes it by then (e.g. tonight's updates). */
  autoFixAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

export type AgentStatus = "reporting" | "stale" | "never";

/** The last agent report as stored by the API (see services/agent-report.ts). */
export type ServerReport = {
  receivedAt: string;
  kind: "metrics" | "full";
  host: {
    hostname: string;
    os?: string | null;
    kernel?: string | null;
    uptimeSeconds?: number | null;
    cpuCount: number;
    load: [number, number, number];
    /** Agent 1.8.0+: measured utilization since the last report. */
    cpu?: { usagePct: number; iowaitPct: number; stealPct: number } | null;
    memory: { totalBytes: number; availableBytes: number };
    swap?: { totalBytes: number; freeBytes: number } | null;
    disks: Array<{
      mount: string;
      fsType?: string | null;
      totalBytes: number;
      usedBytes: number;
    }>;
    cpuPct: number;
    memoryPct: number;
    diskPct: number | null;
  };
  updates: {
    manager: string;
    pending: number;
    security: number;
    packages: Array<{
      name: string;
      current?: string | null;
      candidate?: string | null;
      security?: boolean;
    }>;
    rebootRequired?: boolean | null;
    rebootRequiredSince?: string | null;
    rebootPackages?: string[] | null;
    unattended?: {
      lastRunAt?: string | null;
      lastResult?: "ok" | "error" | "unknown" | null;
      lastError?: string | null;
      nextRunAt?: string | null;
      rebootScheduledAt?: string | null;
    } | null;
    autoUpdates?: boolean | null;
    listsAgeHours?: number | null;
    error?: string | null;
  } | null;
  crowdsec: {
    available: boolean;
    error?: string | null;
    bouncers: Array<{
      name: string;
      type?: string | null;
      lastPull?: string | null;
      valid?: boolean | null;
    }>;
    activeDecisions?: number | null;
    alerts24h?: number | null;
    topScenarios: Array<{ scenario: string; count: number }>;
  } | null;
  containers: Array<{
    name: string;
    image: string;
    status?: string | null;
    state?: string | null;
    health?: "healthy" | "unhealthy" | "starting" | null;
    app?: string | null;
    memBytes?: number | null;
    memLimit?: number | null;
    cpuPct?: number | null;
    oomKilled?: boolean | null;
    restartCount?: number | null;
    /** Agent 1.10.0+ */
    imageCreated?: string | null;
    imageDigest?: string | null;
    startedAt?: string | null;
  }> | null;
  services?: Array<{
    name: string;
    running: number;
    desired: number;
    mode?: string | null;
  }> | null;
  hardening?: {
    ssh?: Record<string, string> | null;
    ufw?: "active" | "inactive" | "not installed" | null;
    fail2ban?: string | null;
  } | null;
  access?: {
    sshKeys: Array<{
      user: string;
      type: string;
      fingerprint: string;
      comment?: string | null;
    }>;
    privilegedGroups: Record<string, string[]>;
    uid0: string[];
  } | null;
  compromise?: { hits: Array<{ kind: string; detail: string }> } | null;
  /** Agent 1.9.0+: `docker system df`, measured hourly. */
  dockerDisk?: {
    images?: DockerDiskPart | null;
    buildCache?: DockerDiskPart | null;
    containers?: DockerDiskPart | null;
    volumes?: DockerDiskPart | null;
    measuredAt?: string | null;
  } | null;
  /** Agent 1.14.0+: object storage and watched folders, measured hourly. */
  storage?: {
    items: StorageItem[];
    measuredAt?: string | null;
  } | null;
  /** Growth per day and days left, by "disk:<mount>" / "storage:<name>". */
  storageForecast?: Record<
    string,
    { perDay: number; daysLeft: number | null }
  > | null;
  backups?: Array<{
    name: string;
    path: string;
    newestAt?: string | null;
    sizeBytes?: number | null;
    error?: string | null;
  }> | null;
  trivy: {
    scannedAt: string;
    available: boolean;
    error: string | null;
    targets: Array<{
      target: string;
      kind: "host" | "image";
      containers: string[];
      count: number;
      /** Trivy reports from 2026-10 on. */
      severities?: Record<string, number>;
      fixable?: number;
    }>;
    counts: Record<string, number>;
    total: number;
  } | null;
};

export type KumaMonitorState = {
  name: string;
  type: string | null;
  url: string | null;
  hostname: string | null;
  status: number | null;
  statusLabel: "down" | "up" | "pending" | "maintenance" | null;
  responseTimeMs: number | null;
  certDaysRemaining: number | null;
  certValid: boolean | null;
};

export type ServerScanRun = {
  id: string;
  status: "pending" | "running" | "success" | "failed";
  targets: string[];
  startedAt: string;
  finishedAt: string | null;
  findingCount: number | null;
  errorMessage: string | null;
  log: string | null;
  /** Live nuclei stats while running (updated every ~15 s). */
  progress?: {
    percent: number;
    requests: number;
    total: number;
    rps: number;
    matched: number;
    errors: number;
    duration: string;
    updatedAt: string;
  } | null;
};

export type ServerBase = {
  id: string;
  name: string;
  agentTokenSet: boolean;
  agentTokenPrefix: string | null;
  agentTokenCreatedAt: string | null;
  /** An install command was generated and not used (or expired) yet. */
  enrollmentPending: boolean;
  agentStatus: AgentStatus;
  agentVersion: string | null;
  /** Version this Moatline ships; a reinstall brings it. */
  latestAgentVersion: string | null;
  agentOutdated: boolean;
  hostname: string | null;
  os: string | null;
  lastReportAt: string | null;
  lastFullReportAt: string | null;
  lastReport: ServerReport | null;
  nucleiTargets: string[];
  nucleiSchedule: string | null;
  kumaMonitors: string[];
  wazuhAgentId: string | null;
  address: string | null;
  expectedPorts: number[];
  networkState: NetworkState | null;
  providerFirewall: ProviderFirewall | null;
  workloadBaseline: WorkloadBaseline | null;
  backupChecks: BackupCheck[];
  storageChecks: StorageCheck[];
  kumaState: {
    checkedAt?: string;
    error?: string | null;
    errorAt?: string;
    monitors?: KumaMonitorState[];
  } | null;
  wazuhState: {
    checkedAt?: string;
    error?: string | null;
    errorAt?: string;
    agent?: {
      id: string;
      name: string | null;
      status: string | null;
      version: string | null;
      os: string | null;
      lastKeepAlive: string | null;
    } | null;
    sca?: Array<{
      policyId: string;
      name: string;
      pass: number;
      fail: number;
      score: number | null;
      endScan: string | null;
    }>;
  } | null;
  cpuThreshold: number;
  memoryThreshold: number;
  diskThreshold: number;
  createdAt: string;
  counts: FindingCounts;
};

export type NetworkState = {
  checkedAt: string;
  address: string;
  resolved: string[];
  ports: Array<{
    port: number;
    open: boolean;
    latencyMs: number | null;
    service: string;
    expected: boolean;
  }>;
  tls: {
    port: number;
    validTo: string | null;
    daysRemaining: number | null;
    issuer: string | null;
    subject: string | null;
    authorized: boolean | null;
    error: string | null;
  } | null;
  error: string | null;
};

export type ServerListItem = ServerBase & {
  lastNucleiRun: {
    status: ServerScanRun["status"];
    startedAt: string;
    findingCount: number | null;
  } | null;
  applications: Array<{ id: string; name: string }>;
};

export type ServerDetail = ServerBase & {
  applications: Array<{
    id: string;
    name: string;
    liveUrl: string | null;
    liveStatus: "up" | "down" | null;
  }>;
  nextNucleiAt: string | null;
  install: AgentInstall;
};

export type AgentInstall = {
  /** URL the agents report to (AGENT_BASE_URL on the API). */
  baseUrl: string;
  /** True for localhost and the like — no other server can reach it. */
  baseUrlLocalOnly: boolean;
  bootstrapUrl: string;
  /** save-server scripts served by this app, with their checksums. */
  setupScripts: Array<{ name: string; url: string; sha256: string | null }>;
  scriptUrl: string;
  sha256: string | null;
  /** Updates an installed agent in place (same token, same settings). */
  updateCommand: string;
  commands: string[];
};

export type AgentUpdate = {
  latest: string | null;
  command: string;
  servers: Array<{
    id: string;
    name: string;
    address: string | null;
    agentVersion: string | null;
  }>;
};

export type BackupCheck = { name: string; path: string; maxAgeHours: number };

export type StorageCheck = {
  name: string;
  /** A folder to measure; null for storage the agent found by itself. */
  path: string | null;
  limitGb: number | null;
};

export type StorageItem = {
  name: string;
  /** minio, garage, seaweedfs, rustfs, … or "folder". */
  kind: string;
  container?: string | null;
  paths: string[];
  sizeBytes?: number | null;
  folders: Array<{ name: string; sizeBytes: number }>;
  disk?: { mount: string; totalBytes: number; usedBytes: number } | null;
  error?: string | null;
};

export type ServerUpdate = Partial<{
  backupChecks: BackupCheck[];
  storageChecks: StorageCheck[];
  name: string;
  nucleiTargets: string[];
  nucleiSchedule: string | null;
  kumaMonitors: string[];
  wazuhAgentId: string | null;
  address: string | null;
  expectedPorts: number[];
  cpuThreshold: number;
  memoryThreshold: number;
  diskThreshold: number;
  repositoryIds: string[];
}>;

export type UptimeMonitor = KumaMonitorState & {
  serverId: string | null;
  serverName: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  /** "manual" = picked on a server, "url" = matched by an app's live URL. */
  via: "manual" | "url" | null;
};

export type UptimeOverview = {
  configured: boolean;
  baseUrl: string | null;
  checkedAt: string | null;
  error: string | null;
  monitors: UptimeMonitor[];
  servers: Array<{ id: string; name: string }>;
};

/** How this instance runs: self-hosted, or the cloud with open sign-up. */
export type SystemMode = {
  cloud: boolean;
  signupOpen: boolean;
  /** No account exists yet: the first one sets the instance up. */
  firstAccount?: boolean;
  emailVerification: boolean;
};

export type OrgFinding = ServerFinding & {
  serverName: string | null;
  repositoryName: string | null;
};

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  allowedRepoIds: string[] | null;
  allowedServerIds: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type AutomationPolicy = {
  defaultAutoFixCritical: boolean;
  allowMcpSecurityFix: boolean;
  requirePrReview: boolean;
};

export type AuditEntry = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  userEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
};

export type ServerMetricPoint = {
  recordedAt: string;
  cpuPct: number | null;
  memoryPct: number | null;
  diskPct: number | null;
};

/** Each app's 7-day median memory (bytes) and CPU (100 = one core). */
export type WorkloadBaseline = {
  computedAt: string;
  apps: Record<
    string,
    { mem: number; cpu: number | null; samples: number; since: string }
  >;
};

/** The Dokploy service behind a container — what a redeploy restarts. */
export type ContainerService = {
  provider?: "dokploy" | "coolify" | "komodo" | "portainer";
  kind:
    | "application"
    | "compose"
    | "postgres"
    | "mysql"
    | "mariadb"
    | "mongo"
    | "redis"
    | "coolify-application"
    | "coolify-service"
    | "coolify-database";
  name: string;
  project: string;
  environment: string | null;
};

export type ContainerMetricPoint = {
  recordedAt: string;
  memBytes: number;
  cpuPct: number | null;
};

export type ProviderFirewall = {
  provider: "hetzner";
  checkedAt: string;
  serverName: string;
  firewalls: Array<{ id: number; name: string; status: string }>;
  inbound: Array<{
    protocol: string;
    port: string | null;
    sources: string[];
    description: string | null;
    firewall: string;
  }>;
};

export type GitHostKind = "github" | "gitlab" | "gitea" | "bitbucket";

/** GitLab, Gitea/Forgejo or Bitbucket, added under Settings. */
export type GitHostEntry = {
  id: string;
  kind: Exclude<GitHostKind, "github">;
  url: string;
  username: string | null;
  tokenSet: boolean;
};

export type BranchRow = {
  name: string;
  sha: string;
  date: string | null;
  protected: boolean;
  status: "default" | "merged" | "open_pr" | "unmerged" | "unknown";
  mergedPr: { number: number; url: string; mergedAt: string | null } | null;
  openPr: { number: number; url: string; title: string } | null;
  ours: boolean;
};

export type BranchOverview = {
  branches: BranchRow[];
  truncated: boolean;
  host?: string;
  canDelete?: boolean;
  checkedAt: string;
};

export type OrgIntegrations = {
  githubTokenSet: boolean;
  githubApp?: {
    name: string;
    slug: string;
    htmlUrl: string;
    installations: Array<{ id: number; account: string; type: string }>;
  } | null;
  gitHosts?: GitHostEntry[];
  dokployBaseUrl: string | null;
  dokployTokenSet: boolean;
  coolifyBaseUrl?: string | null;
  coolifyTokenSet?: boolean;
  komodoBaseUrl?: string | null;
  komodoKeySet?: boolean;
  portainerBaseUrl?: string | null;
  portainerTokenSet?: boolean;
  otlpEndpoint?: string | null;
  otlpHeadersSet?: boolean;
  grafanaUrl?: string | null;
  grafanaTokenSet?: boolean;
  eventWebhookSet?: boolean;
  alertReceiverSet?: boolean;
  slackWebhookUrlSet: boolean;
  telegramBotTokenSet: boolean;
  telegramChatId: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassSet: boolean;
  smtpFrom: string | null;
  notifyEmailTo: string | null;
  kumaBaseUrl: string | null;
  kumaApiKeySet: boolean;
  weeklyDigest: boolean;
  lastDigestAt: string | null;
  wazuhApiUrl: string | null;
  wazuhUser: string | null;
  wazuhPasswordSet: boolean;
  wazuhCaCertSet: boolean;
  hetznerTokenCount: number;
  pagespeedApiKeySet?: boolean;
  notifyLanguage?: "en" | "de";
  hetznerState: {
    checkedAt: string;
    tokens: number;
    servers: number;
    matched: number;
    error: string | null;
  } | null;
  automationPolicy: AutomationPolicy;
};

export type OrgIntegrationsUpdate = Partial<{
  githubToken: string;
  dokployBaseUrl: string;
  dokployToken: string;
  coolifyBaseUrl: string;
  coolifyToken: string;
  komodoBaseUrl: string;
  komodoApiKey: string;
  komodoApiSecret: string;
  portainerBaseUrl: string;
  portainerToken: string;
  otlpEndpoint: string;
  otlpHeaders: string;
  grafanaUrl: string;
  grafanaToken: string;
  eventWebhookUrl: string;
  slackWebhookUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  smtpHost: string;
  smtpPort: number | null;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  notifyEmailTo: string;
  kumaBaseUrl: string;
  kumaApiKey: string;
  wazuhApiUrl: string;
  wazuhUser: string;
  wazuhPassword: string;
  wazuhCaCert: string;
  hetznerTokens: string;
  pagespeedApiKey: string;
  notifyLanguage: "en" | "de";
  weeklyDigest: boolean;
  automationPolicy: AutomationPolicy;
}>;

export type SchedulerStatus = {
  /** False when the API runs without ENABLE_SCHEDULER=true – no automatic scans. */
  enabled: boolean;
  checkInterval: string;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  scheduledRepos: number;
  lastError: string | null;
};

/** Last known state of the repository's deployed URL, or nulls when unset. */
export type LiveState = {
  liveUrl: string | null;
  liveStatus: "up" | "down" | null;
  liveHttpStatus: number | null;
  /** Commit the deployment reports about itself, when it reports one. */
  liveCommit: string | null;
  liveError: string | null;
  liveCheckedAt: string | null;
};

/** The health endpoint's `checks` object: flags and times only. */
export type LiveChecks = Record<string, boolean | number | string | null>;

export type ConfigCheck = {
  checkedAt: string;
  items: Array<{
    label: string;
    names: string[];
    required: boolean;
    ok: boolean;
    why: string;
  }>;
};

/** Read-only checks of the live site from outside. */
export type SiteProbe = {
  checkedAt: string;
  origin: string;
  payload: boolean;
  findings: Array<{
    id: string;
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    detail: string;
    url: string;
  }>;
};

/** One Lighthouse run (PageSpeed Insights) of a live site. */
export type PerfRun = {
  id: string;
  createdAt: string;
  url: string;
  strategy: "mobile" | "desktop";
  trigger: "schedule" | "deploy" | "manual";
  commit: string | null;
  error: string | null;
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  bytes: number | null;
  fieldLcpMs: number | null;
  fieldInpMs: number | null;
  fieldCls: number | null;
};

export type DomainState = {
  cert: {
    ok: boolean;
    validTo: string | null;
    daysLeft: number | null;
    issuer: string | null;
    error: string | null;
  };
  registration: { expires: string | null; daysLeft: number | null };
  mail: {
    mx: string[];
    spf: string | null;
    dmarc: string | null;
    dmarcPolicy: string | null;
    dkim: string[];
  };
  problems: Array<{
    id: string;
    severity: "high" | "medium" | "low";
    text: string;
  }>;
};

export type Domain = {
  id: string;
  name: string;
  clientId: string | null;
  source: "auto" | "manual";
  checkedAt: string | null;
  state: DomainState | null;
};

export type ClientListItem = {
  id: string;
  name: string;
  contactEmail: string | null;
  notes: string | null;
  language: "de" | "en";
  repos: number;
  down: number;
  servers: number;
  domains: number;
  domainProblems: number;
};

export type ClientDetail = Omit<
  ClientListItem,
  "repos" | "servers" | "domains" | "down" | "domainProblems"
> & {
  repos: Array<{
    id: string;
    name: string;
    githubUrl: string;
    liveUrl: string | null;
    liveStatus: "up" | "down" | null;
  }>;
  servers: Array<{ id: string; name: string; lastReportAt: string | null }>;
  domains: Domain[];
};

export type RepoListItem = LiveState & {
  id: string;
  name: string;
  githubUrl: string;
  gitHost?: GitHostKind | null;
  defaultBranch?: string;
  packageJsonPath?: string;
  lastScannedAt: string | null;
  scanSchedule: string | null;
  lastScanStatus: string | null;
  nextScanAt: string | null;
  dokployApplicationId?: string | null;
  coolifyAppUuid?: string | null;
  platformKind?: string | null;
  platformAppId?: string | null;
  liveChecks?: LiveChecks | null;
  configCheck?: ConfigCheck | null;
  siteProbe?: SiteProbe | null;
  /** The latest mobile Lighthouse run, in short. */
  perf?: {
    performance: number | null;
    lcpMs: number | null;
    failures: number;
  } | null;
  /** From the latest successful scan; null before the first one. */
  vulns?: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    fixable: number;
  } | null;
  outdated?: { total: number; major: number } | null;
  lastDeploy?: {
    status: "triggered" | "succeeded" | "failed";
    guard: DeployRun["guard"];
    liveOk: boolean | null;
    triggeredAt: string;
  } | null;
  /** Every open PR on the Git host (people, Dependabot, Moatline). */
  openPrs?: Array<{
    number: number;
    title: string;
    url: string;
    author: string | null;
    draft: boolean;
    createdAt: string;
    ours: boolean;
  }> | null;
  /** The newest update/fix run while it still needs something. */
  openRun?: {
    id: string;
    kind: string;
    status: string;
    prUrl: string | null;
    buildOk: boolean | null;
  } | null;
};

export type Repo = LiveState & {
  id: string;
  name: string;
  /** The repository's URL — on any Git host, despite the name. */
  githubUrl: string;
  /** Where it lives; null for a URL no host claims anymore. */
  gitHost?: GitHostKind | null;
  migrationCheck?: MigrationCheck | null;
  /** Watched tips: the default branch on its host, and what runs in production. */
  branchHead?: string | null;
  deployedCommit?: string | null;
  clientId?: string | null;
  defaultBranch?: string;
  packageJsonPath?: string;
  lastScannedAt?: string | null;
  nextScanAt?: string | null;
  autoFixCritical: boolean;
  autoFixForce: boolean;
  autoMerge: boolean;
  autoDeploy: boolean;
  autoRollback?: boolean;
  autoHeal?: boolean;
  liveChecks?: LiveChecks | null;
  configCheck?: ConfigCheck | null;
  siteProbe?: SiteProbe | null;
  dokployApplicationId: string | null;
  coolifyAppUuid?: string | null;
  platformKind?: string | null;
  platformAppId?: string | null;
  /** Dokploy's service name for the app, filled by the sync. */
  dokployAppName?: string | null;
  scanSchedule: string | null;
  packageManager: "npm" | "pnpm" | "yarn" | null;
  verifyMode: VerifyMode;
  serverId: string | null;
};

/** A repository one of the organization's Git tokens can read. */
export type GithubRepo = {
  host: GitHostKind;
  hostLabel: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  description: string | null;
  language: string | null;
  connected: boolean;
};

type DokployBrief = {
  applicationId: string;
  kind: "application" | "compose";
  name: string;
  project: string;
  environment: string | null;
  branch: string | null;
};

/** What "add everything from Dokploy" would add. */
export type DokployImportPlan = {
  candidates: Array<DokployBrief & { githubRepo: string; also: string[] }>;
  existing: Array<
    DokployBrief & { repositoryId: string; repositoryName: string }
  >;
  unsupported: DokployBrief[];
};

export type DokployApp = {
  applicationId: string;
  kind?: "application" | "compose";
  name: string;
  appName: string;
  project: string;
  environment: string | null;
  githubRepo: string | null;
  branch: string | null;
  autoDeploy: boolean;
};

/** How fixes and updates are checked before their PR. */
export type VerifyMode = "typecheck" | "build" | "none";

export type RepoUpdate = Partial<{
  defaultBranch: string;
  packageJsonPath: string;
  autoFixCritical: boolean;
  autoFixForce: boolean;
  autoMerge: boolean;
  autoDeploy: boolean;
  autoRollback: boolean;
  autoHeal: boolean;
  dokployApplicationId: string | null;
  coolifyAppUuid?: string | null;
  platformApp?: { kind: "komodo" | "portainer"; id: string } | null;
  liveUrl: string | null;
  scanSchedule: string | null;
  packageManager: "npm" | "pnpm" | "yarn" | null;
  verifyMode: VerifyMode;
  serverId: string | null;
  clientId: string | null;
}>;

export type UpdateRun = {
  id: string;
  status: string;
  /** Phase inside the current status ("install", "build", …), null when idle. */
  currentStep: string | null;
  buildOk: boolean | null;
  logOutput: string | null;
  prUrl: string | null;
  branchName?: string;
  merged: boolean;
  kind: string;
  triggerSource?: "manual" | "auto" | "mcp" | null;
  triggerDetail?: { apiKey?: string } | null;
  /** Did a second audit show the advisories gone? null = not checked. */
  securityVerified?: boolean | null;
  securitySummary?: string | null;
};

export type DeployRun = {
  id: string;
  status: "triggered" | "succeeded" | "failed";
  triggeredAt: string;
  dokployApplicationId: string | null;
  coolifyAppUuid?: string | null;
  errorMessage: string | null;
  /** null while the live URL is still being watched, or when none is set. */
  liveOk: boolean | null;
  liveDetail: string | null;
  liveVerifiedAt: string | null;
  /** What the deploy guard concluded or did; null = not guarded. */
  guard?:
    | "healthy"
    | "build_failed"
    | "broken"
    | "error_spike"
    | "rolled_back"
    | "rollback_failed"
    | null;
  guardDetail?: string | null;
};

export type Scan = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  currentStep?: string | null;
  errorMessage?: string | null;
  /** "default" = the repo's branch, "live" = the commit a deployment reports. */
  target?: "default" | "live";
  /** Branch name or commit SHA this scan looked at. */
  ref?: string | null;
  /** Set when the audit could not run — why there is no CVE data. */
  auditNote?: string | null;
};

export type Vulnerability = {
  id: string;
  scanId: string;
  packageName: string;
  severity: VulnSeverity;
  ghsaId: string | null;
  cveId: string | null;
  title: string | null;
  url: string | null;
  vulnerableRange: string | null;
  patchedVersion: string | null;
  fixAvailable: boolean;
  fixIsSemverMajor: boolean;
  isDirect: boolean;
  cvssScore: string | null;
};

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (useDemoOrg) headers["X-Use-Demo-Org"] = "true";

  const res = await request(`${base}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
  if (!res.ok) throw await requestError(res);
  return res.json();
}

/** fetch, with a network failure said in words instead of "Failed to fetch". */
async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error(
      tx(
        "Moatline is not reachable right now. Check your connection and reload the page."
      )
    );
  }
}

/** The API's message, translated; the common statuses in plain words. */
export async function requestError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  const msg = typeof body?.error === "string" ? body.error : null;
  if (res.status === 429)
    return new Error(
      tx("Too many requests in a short time. Wait a minute and reload.")
    );
  if (res.status === 401)
    return new Error(
      tx("You are no longer signed in. Sign in again to continue.")
    );
  if (res.status === 403 && !msg)
    return new Error(tx("You do not have permission to do this."));
  if (res.status >= 500 && !msg)
    return new Error(
      tx("Something went wrong on the server. Try again in a moment.")
    );
  return new Error(msg ? tx(msg) : res.statusText || tx("Request failed"));
}

/** A text download (e.g. markdown) through the same auth as fetchApi. */
async function fetchText(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (useDemoOrg) headers["X-Use-Demo-Org"] = "true";
  const res = await request(`${base}${path}`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) throw await requestError(res);
  return res.text();
}

export const api = {
  getPerfRuns: (repoId: string) =>
    fetchApi<PerfRun[]>(`/api/repos/${repoId}/perf-runs`),
  runPerf: (repoId: string) =>
    fetchApi<PerfRun[]>(`/api/repos/${repoId}/perf`, { method: "POST" }),
  probeSite: (repoId: string) =>
    fetchApi<SiteProbe>(`/api/repos/${repoId}/site-probe`, { method: "POST" }),
  getFindingsMarkdown: (repoId: string) =>
    fetchText(`/api/repos/${repoId}/findings.md`),
  getRepos: () => fetchApi<RepoListItem[]>("/api/repos"),
  getSchedulerStatus: () => fetchApi<SchedulerStatus>("/api/system/scheduler"),
  getSystemMode: () => fetchApi<SystemMode>("/api/system/mode"),
  createRepo: (body: {
    githubUrl: string;
    name?: string;
    defaultBranch?: string;
    packageJsonPath?: string;
  }) =>
    fetchApi<{ id: string }>("/api/repos", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getRepo: (id: string) => fetchApi<Repo>(`/api/repos/${id}`),
  updateRepo: (id: string, body: RepoUpdate) =>
    fetchApi<Repo>(`/api/repos/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteRepo: (id: string) =>
    fetchApi<{ deleted: boolean }>(`/api/repos/${id}`, { method: "DELETE" }),
  getGithubRepos: () =>
    fetchApi<{
      repos: GithubRepo[];
      sources: Array<{
        id: string;
        kind: GitHostKind;
        label: string;
        origin: string;
        count: number;
        error: string | null;
      }>;
    }>("/api/git/repos"),
  getBranches: (url: string) =>
    fetchApi<{ branches: string[] }>(
      `/api/git/branches?url=${encodeURIComponent(url)}`
    ),
  getRepoBranches: (id: string, refresh = false) =>
    fetchApi<BranchOverview>(
      `/api/repos/${id}/branches${refresh ? "?refresh=1" : ""}`
    ),
  deleteRepoBranches: (id: string, names: string[]) =>
    fetchApi<{
      deleted: string[];
      refused: Array<{ name: string; reason: string }>;
    }>(`/api/repos/${id}/branches`, {
      method: "DELETE",
      body: JSON.stringify({ names }),
    }),
  addGitHost: (body: {
    kind: GitHostEntry["kind"];
    url?: string;
    username?: string;
    token: string;
  }) =>
    fetchApi<{ id: string; account: string }>(
      "/api/org/integrations/git-hosts",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    ),
  removeGitHost: (id: string) =>
    fetchApi<{ ok: true }>(`/api/org/integrations/git-hosts/${id}`, {
      method: "DELETE",
    }),
  getScans: (repoId: string) => fetchApi<Scan[]>(`/api/repos/${repoId}/scans`),
  getUpdateStatus: () => fetchApi<UpdateStatus>("/api/system/update"),
  startSelfUpdate: () =>
    fetchApi<{ ok: true; version: string }>("/api/system/update", {
      method: "POST",
    }),
  sendTestEvent: () =>
    fetchApi<{
      sent: string[];
      failed: Array<{ target: string; error: string }>;
    }>("/api/org/observability/test-event", { method: "POST" }),
  setupOpenObserve: (body: {
    environment: { id: string; legacy: boolean };
    serverId: string | null;
    domain: string;
    email: string;
  }) =>
    fetchApi<{ ok: true; url: string; email: string; password: string }>(
      "/api/org/observability/openobserve",
      { method: "POST", body: JSON.stringify(body) }
    ),
  createAlertReceiver: () =>
    fetchApi<{ url: string }>("/api/org/observability/alert-receiver", {
      method: "POST",
    }),
  getBilling: () => fetchApi<BillingState>("/api/billing"),
  isOperator: () => fetchApi<{ operator: boolean }>("/api/operator/me"),
  getOperatorStats: () => fetchApi<OperatorStats>("/api/operator/stats"),
  getMaintenance: () =>
    fetchApi<{ windows: MaintenanceWindow[] }>("/api/maintenance"),
  startMaintenance: (body: {
    scope: MaintenanceWindow["scope"];
    targetId?: string | null;
    minutes: number;
    reason?: string | null;
  }) =>
    fetchApi<MaintenanceWindow>("/api/maintenance", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  endMaintenance: (id: string) =>
    fetchApi<{ ok: true }>(`/api/maintenance/${id}`, { method: "DELETE" }),
  getCronChecks: () => fetchApi<{ checks: CronCheck[] }>("/api/cron-checks"),
  createCronCheck: (body: {
    name: string;
    periodSeconds: number;
    graceSeconds: number;
  }) =>
    fetchApi<CronCheck>("/api/cron-checks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteCronCheck: (id: string) =>
    fetchApi<{ ok: true }>(`/api/cron-checks/${id}`, { method: "DELETE" }),
  getPlatformWatch: () => fetchApi<PlatformWatch | null>("/api/platform-watch"),
  checkPlatforms: () =>
    fetchApi<PlatformWatch>("/api/platform-watch/check", { method: "POST" }),
  checkMigrations: (repoId: string) =>
    fetchApi<MigrationCheck>(`/api/repos/${repoId}/migrations`, {
      method: "POST",
    }),
  getPublicStatus: (slug: string) =>
    fetchApi<PublicStatus>(`/api/public/status/${encodeURIComponent(slug)}`),
  getStatusPages: () => fetchApi<{ pages: StatusPage[] }>("/api/status-pages"),
  createStatusPage: (body: StatusPageInput) =>
    fetchApi<StatusPage>("/api/status-pages", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateStatusPage: (id: string, body: StatusPageInput) =>
    fetchApi<StatusPage>(`/api/status-pages/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteStatusPage: (id: string) =>
    fetchApi<{ ok: true }>(`/api/status-pages/${id}`, { method: "DELETE" }),
  checkout: (plan: PlanId) =>
    fetchApi<{ url: string }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan }),
    }),
  changePlan: (plan: PlanId) =>
    fetchApi<{ url: string }>("/api/billing/plan", {
      method: "POST",
      body: JSON.stringify({ plan }),
    }),
  billingPortal: () =>
    fetchApi<{ url: string }>("/api/billing/portal", { method: "POST" }),
  getProvisionOptions: () =>
    fetchApi<ProvisionOptions>("/api/provision/options"),
  getTemplateEnv: (repo: string) =>
    fetchApi<TemplateEnvKey[]>(
      `/api/provision/template-env?repo=${encodeURIComponent(repo)}`
    ),
  startProvision: (input: ProvisionInput) =>
    fetchApi<{ id: string }>("/api/provision", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getProvisionRun: (id: string) =>
    fetchApi<ProvisionRun>(`/api/provision/${id}`),
  getChecks: (repoId: string) =>
    fetchApi<{
      presets: Record<
        string,
        { name: string; steps: CheckStep[]; variables: string[] }
      >;
      checks: SyntheticCheck[];
    }>(`/api/repos/${repoId}/checks`),
  createCheck: (repoId: string, body: CheckInput) =>
    fetchApi<{ id: string }>(`/api/repos/${repoId}/checks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCheck: (repoId: string, checkId: string, body: CheckInput) =>
    fetchApi<{ ok: true }>(`/api/repos/${repoId}/checks/${checkId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteCheck: (repoId: string, checkId: string) =>
    fetchApi<{ ok: true }>(`/api/repos/${repoId}/checks/${checkId}`, {
      method: "DELETE",
    }),
  runCheck: (repoId: string, checkId: string) =>
    fetchApi<{ ok: boolean; steps: CheckStepResult[] }>(
      `/api/repos/${repoId}/checks/${checkId}/run`,
      { method: "POST" }
    ),
  getPlatformLink: (repoId: string) =>
    fetchApi<{ url: string; platform: string }>(
      `/api/repos/${repoId}/platform-link`
    ),
  getRepoIncidents: (repoId: string) =>
    fetchApi<RepoIncidents>(`/api/repos/${repoId}/incidents`),
  getOpenIncidents: () => fetchApi<OpenIncident[]>("/api/repos/incidents/open"),
  getRepoErrors: (repoId: string, hours = 24) =>
    fetchApi<LogErrorSummary[]>(`/api/repos/${repoId}/errors?hours=${hours}`),
  getServerErrors: (serverId: string, hours = 24, app?: string) =>
    fetchApi<LogErrorSummary[]>(
      `/api/servers/${serverId}/errors?hours=${hours}${app ? `&app=${encodeURIComponent(app)}` : ""}`
    ),
  getServerVersions: () =>
    fetchApi<{
      latestAgent: string | null;
      servers: Array<{
        id: string;
        name: string;
        os: string | null;
        support: {
          name: string;
          eol: string | null;
          status: "eol" | "soon" | "ok" | "unknown";
        };
        kernel: string | null;
        docker: string | null;
        uptimeDays: number | null;
        pending: number | null;
        security: number | null;
        rebootRequired: boolean;
        autoUpdates: boolean | null;
        agentVersion: string | null;
        agentOutdated: boolean;
        lastReportAt: string | null;
      }>;
    }>("/api/servers/versions"),
  getVersions: () => fetchApi<VersionOverview>("/api/repos/versions"),
  bulkUpgrade: (body: {
    family: "Payload" | "Next.js";
    version: string;
    repoIds: string[];
  }) =>
    fetchApi<{ ok: true; started: number }>("/api/repos/bulk-upgrade", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  scanAll: () =>
    fetchApi<{ started: number; skipped: number }>("/api/repos/scan-all", {
      method: "POST",
    }),
  startScan: (repoId: string, opts?: { fast?: boolean }) =>
    fetchApi<{ scanId: string }>(
      `/api/repos/${repoId}/scan${opts?.fast ? "?fast=1" : ""}`,
      { method: "POST" }
    ),
  startLiveScan: (repoId: string) =>
    fetchApi<{
      scanId: string;
      commit: string;
      source: "live" | "dokploy" | "branch";
    }>(`/api/repos/${repoId}/scan-live`, { method: "POST" }),
  getFindings: (scanId: string) =>
    fetchApi<
      Array<{
        packageName: string;
        currentVersion: string;
        latestVersion: string;
        isDevDependency: boolean;
        unused?: boolean;
      }>
    >(`/api/scans/${scanId}/findings`),
  getVulnerabilities: (scanId: string) =>
    fetchApi<Vulnerability[]>(`/api/scans/${scanId}/vulnerabilities`),
  getDashboard: () => fetchApi<DashboardData>("/api/dashboard"),
  getOrgIntegrations: () => fetchApi<OrgIntegrations>("/api/org/integrations"),
  createMemberDirect: (body: {
    email: string;
    name?: string;
    role: "member" | "admin" | "owner";
  }) =>
    fetchApi<{ created: boolean; email: string; password: string | null }>(
      "/api/org/members",
      { method: "POST", body: JSON.stringify(body) }
    ),
  findTelegramChats: (botToken?: string) =>
    fetchApi<{ chats: Array<{ id: string; title: string; type: string }> }>(
      "/api/org/integrations/telegram/chats",
      { method: "POST", body: JSON.stringify({ botToken }) }
    ),
  sendDigestPreview: () =>
    fetchApi<{ ok: boolean; title: string; message: string }>(
      "/api/org/integrations/digest",
      { method: "POST" }
    ),
  getApiKeys: () => fetchApi<ApiKey[]>("/api/org/api-keys"),
  createApiKey: (body: {
    name: string;
    scan: boolean;
    fix: boolean;
    expiresInDays: number | null;
    allowedRepoIds?: string[] | null;
    allowedServerIds?: string[] | null;
  }) =>
    fetchApi<{
      id: string;
      key: string;
      scopes: string[];
      allowedRepoIds: string[] | null;
      allowedServerIds: string[] | null;
    }>("/api/org/api-keys", { method: "POST", body: JSON.stringify(body) }),
  revokeApiKey: (id: string) =>
    fetchApi<{ revoked: boolean }>(`/api/org/api-keys/${id}`, {
      method: "DELETE",
    }),
  sendTestNotification: () =>
    fetchApi<{
      results: Array<{
        channel: "slack" | "telegram" | "email";
        ok: boolean;
        error: string | null;
      }>;
    }>("/api/org/integrations/test", { method: "POST" }),
  updateOrgIntegrations: (body: OrgIntegrationsUpdate) =>
    fetchApi<{ ok: boolean }>("/api/org/integrations", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  startUpdate: (
    repoId: string,
    options?: { withAi?: boolean; target?: "minor" | "latest" }
  ) =>
    fetchApi<{ id: string; branchName: string; status: string }>(
      `/api/repos/${repoId}/update`,
      {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      }
    ),
  getUpdateRun: (id: string) => fetchApi<UpdateRun>(`/api/update-runs/${id}`),
  getRepoUpdateRuns: (repoId: string) =>
    fetchApi<UpdateRun[]>(`/api/repos/${repoId}/update-runs`),
  startSecurityFix: (repoId: string) =>
    fetchApi<{ id: string; branchName: string; status: string }>(
      `/api/repos/${repoId}/security-fix`,
      { method: "POST" }
    ),
  deployRepo: (repoId: string) =>
    fetchApi<{ ok: boolean; deployRunId: string }>(
      `/api/repos/${repoId}/deploy`,
      { method: "POST" }
    ),
  alignRunVersions: (repoId: string, runId: string) =>
    fetchApi<{ ok: true; pinned: Record<string, string>; pushed: boolean }>(
      `/api/repos/${repoId}/update-runs/${runId}/align-versions`,
      { method: "POST" }
    ),
  rollbackDeploy: (repoId: string, deployRunId: string) =>
    fetchApi<{ ok: boolean; detail: string }>(
      `/api/repos/${repoId}/deploy-runs/${deployRunId}/rollback`,
      { method: "POST" }
    ),
  getDeployRun: (id: string) => fetchApi<DeployRun>(`/api/deploy-runs/${id}`),
  getRepoDeployRuns: (repoId: string) =>
    fetchApi<DeployRun[]>(`/api/repos/${repoId}/deploy-runs`),
  checkLive: (repoId: string) =>
    fetchApi<LiveState>(`/api/repos/${repoId}/live-check`, { method: "POST" }),
  createGithubAppManifest: (githubOrg?: string) =>
    fetchApi<{ action: string; manifest: Record<string, unknown> }>(
      "/api/github-app/manifest",
      { method: "POST", body: JSON.stringify({ githubOrg }) }
    ),
  refreshGithubApp: () =>
    fetchApi<{ installations: unknown[] }>("/api/github-app/refresh", {
      method: "POST",
    }),
  removeGithubApp: () =>
    fetchApi<{ ok: true; htmlUrl: string }>("/api/github-app", {
      method: "DELETE",
    }),
  getStackApps: () =>
    fetchApi<{
      apps: Array<{
        platform: "komodo" | "portainer";
        id: string;
        name: string;
        repoUrl: string | null;
        branch: string | null;
      }>;
      linked: number;
    }>("/api/repos/stack-apps"),
  getCoolifyApps: () =>
    fetchApi<{
      apps: Array<{
        uuid: string;
        name: string;
        githubRepo: string | null;
        branch: string | null;
        url: string | null;
      }>;
      linked: number;
    }>("/api/repos/coolify-apps"),
  getDokployApps: () =>
    fetchApi<{ apps: DokployApp[]; linked: number; projects?: number }>(
      "/api/repos/dokploy-apps"
    ),
  getDokployImport: () =>
    fetchApi<DokployImportPlan>("/api/repos/dokploy-import"),
  importFromDokploy: (applicationIds: string[]) =>
    fetchApi<{ created: number }>("/api/repos/dokploy-import", {
      method: "POST",
      body: JSON.stringify({ applicationIds }),
    }),
  mergeRun: (repoId: string, runId: string, deploy: boolean) =>
    fetchApi<{ ok: true; deployed: boolean; deployError?: string }>(
      `/api/repos/${repoId}/update-runs/${runId}/merge`,
      { method: "POST", body: JSON.stringify({ deploy }) }
    ),
  getDokployDomains: (repoId: string) =>
    fetchApi<{ urls: string[] }>(`/api/repos/${repoId}/dokploy-domains`),
  getRepoLiveFindings: (repoId: string) =>
    fetchApi<ServerFinding[]>(`/api/repos/${repoId}/live-findings`),

  getServers: () => fetchApi<ServerListItem[]>("/api/servers"),
  getClients: () => fetchApi<ClientListItem[]>("/api/clients"),
  getClient: (id: string) => fetchApi<ClientDetail>(`/api/clients/${id}`),
  createClient: (body: {
    name: string;
    contactEmail?: string | null;
    language?: "de" | "en";
  }) =>
    fetchApi<ClientListItem>("/api/clients", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateClient: (
    id: string,
    body: Partial<{
      name: string;
      contactEmail: string | null;
      language: "de" | "en";
    }>
  ) =>
    fetchApi<ClientListItem>(`/api/clients/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteClient: (id: string) =>
    fetchApi<{ ok: true }>(`/api/clients/${id}`, { method: "DELETE" }),
  assignToClient: (
    id: string,
    body: {
      repositoryIds?: string[];
      serverIds?: string[];
      domainIds?: string[];
    }
  ) =>
    fetchApi<{ ok: true }>(`/api/clients/${id}/assign`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getClientReport: (id: string, month: string) =>
    fetchText(`/api/clients/${id}/report?month=${encodeURIComponent(month)}`),
  getDomains: () => fetchApi<Domain[]>("/api/domains"),
  addDomain: (name: string, clientId?: string | null) =>
    fetchApi<Domain>("/api/domains", {
      method: "POST",
      body: JSON.stringify({ name, clientId }),
    }),
  checkDomain: (id: string) =>
    fetchApi<DomainState>(`/api/domains/${id}/check`, { method: "POST" }),
  setDomainClient: (id: string, clientId: string | null) =>
    fetchApi<Domain>(`/api/domains/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ clientId }),
    }),
  deleteDomain: (id: string) =>
    fetchApi<{ ok: true }>(`/api/domains/${id}`, { method: "DELETE" }),
  getMyIp: () => fetchApi<{ ip: string | null }>("/api/servers/my-ip"),
  createServer: (name: string, address?: string) =>
    fetchApi<{
      server: ServerBase;
      enrollment: { code: string; expiresAt: string };
      install: AgentInstall;
    }>("/api/servers", {
      method: "POST",
      body: JSON.stringify({ name, address: address || null }),
    }),
  getDokployMissing: () =>
    fetchApi<{ servers: MissingServer[]; error?: string }>(
      "/api/servers/dokploy-missing"
    ),
  getServerImages: (id: string) =>
    fetchApi<{ images: ImageStatus[] }>(`/api/servers/${id}/images`),
  getAgentUpdate: () => fetchApi<AgentUpdate>("/api/servers/agent-update"),
  acceptServerAccess: (id: string) =>
    fetchApi<{ accepted: boolean }>(`/api/servers/${id}/access/accept`, {
      method: "POST",
    }),
  runNetworkCheck: (id: string) =>
    fetchApi<NetworkState>(`/api/servers/${id}/network-check`, {
      method: "POST",
    }),
  getServer: (id: string) => fetchApi<ServerDetail>(`/api/servers/${id}`),
  updateServer: (id: string, body: ServerUpdate) =>
    fetchApi<ServerBase>(`/api/servers/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteServer: (id: string) =>
    fetchApi<{ deleted: boolean }>(`/api/servers/${id}`, { method: "DELETE" }),
  createEnrollment: (id: string) =>
    fetchApi<{
      enrollment: { code: string; expiresAt: string };
      install: AgentInstall;
    }>(`/api/servers/${id}/enrollment`, { method: "POST" }),
  revokeServerToken: (id: string) =>
    fetchApi<{ revoked: boolean }>(`/api/servers/${id}/token`, {
      method: "DELETE",
    }),
  getServerFindings: (
    id: string,
    opts?: {
      status?: "open" | "resolved";
      source?: FindingSource;
      /** Fingerprint prefix, e.g. one image's CVEs: "image|<ref>|". */
      prefix?: string;
    }
  ) => {
    const q = new URLSearchParams();
    if (opts?.status) q.set("status", opts.status);
    if (opts?.source) q.set("source", opts.source);
    if (opts?.prefix) q.set("prefix", opts.prefix);
    const qs = q.toString();
    return fetchApi<ServerFinding[]>(
      `/api/servers/${id}/findings${qs ? `?${qs}` : ""}`
    );
  },
  getContainerMetrics: (id: string, app: string, hours = 24) =>
    fetchApi<ContainerMetricPoint[]>(
      `/api/servers/${id}/container-metrics?app=${encodeURIComponent(app)}&hours=${hours}`
    ),
  getContainerServices: (id: string) =>
    fetchApi<{
      services: Record<string, ContainerService>;
      error?: string;
    }>(`/api/servers/${id}/container-services`),
  redeployContainer: (id: string, app: string) =>
    fetchApi<{ ok: true; service: ContainerService }>(
      `/api/servers/${id}/containers/redeploy`,
      { method: "POST", body: JSON.stringify({ app }) }
    ),
  getServerMetrics: (id: string, hours = 24) =>
    fetchApi<ServerMetricPoint[]>(`/api/servers/${id}/metrics?hours=${hours}`),
  getServerScanRuns: (id: string) =>
    fetchApi<ServerScanRun[]>(`/api/servers/${id}/scan-runs`),
  cleanDocker: (id: string, what: "builder" | "images") =>
    fetchApi<{ ok: true }>(`/api/servers/${id}/docker-cleanup`, {
      method: "POST",
      body: JSON.stringify({ what }),
    }),
  startNuclei: (id: string) =>
    fetchApi<{ runId: string }>(`/api/servers/${id}/nuclei`, {
      method: "POST",
    }),
  getAuditLog: (before?: string, agentsOnly?: boolean) => {
    const q = new URLSearchParams();
    if (before) q.set("before", before);
    if (agentsOnly) q.set("agents", "1");
    const qs = q.toString();
    return fetchApi<AuditEntry[]>(
      `/api/org/audit${qs ? `?${qs}` : ""}`
    );
  },
  updateApiKey: (
    id: string,
    body: {
      name?: string;
      scan?: boolean;
      fix?: boolean;
      allowedRepoIds?: string[] | null;
      allowedServerIds?: string[] | null;
    }
  ) =>
    fetchApi<ApiKey>(`/api/org/api-keys/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getUptime: () => fetchApi<UptimeOverview>("/api/monitoring/uptime"),
  refreshUptime: () =>
    fetchApi<UptimeOverview>("/api/monitoring/uptime/refresh", {
      method: "POST",
    }),
  assignMonitor: (monitor: string, serverId: string | null) =>
    fetchApi<UptimeOverview>("/api/monitoring/uptime/assign", {
      method: "PUT",
      body: JSON.stringify({ monitor, serverId }),
    }),
  getOrgFindings: (source?: FindingSource) =>
    fetchApi<OrgFinding[]>(
      `/api/monitoring/findings${source ? `?source=${source}` : ""}`
    ),
  /** Open findings that belong on a to-do list (no medium/low CVE rows). */
  getImportantFindings: () =>
    fetchApi<OrgFinding[]>("/api/monitoring/findings?important=true"),
  getKumaMonitors: () =>
    fetchApi<{
      monitors: Array<{
        name: string;
        url: string | null;
        type: string | null;
      }>;
    }>("/api/servers/kuma/monitors"),
};
