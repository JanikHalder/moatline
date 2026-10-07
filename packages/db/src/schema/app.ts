import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  bigint,
  index,
  jsonb,
  real,
  uniqueIndex,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    githubUrl: text("github_url").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    packageJsonPath: text("package_json_path")
      .notNull()
      .default("package.json"),
    lastScannedAt: timestamp("last_scanned_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Autonomous security pipeline – strict escalation ladder, all default OFF:
    // autoDeploy ⇒ autoMerge ⇒ autoFixCritical (enforced in the API layer).
    autoFixCritical: boolean("auto_fix_critical").notNull().default(false),
    autoFixForce: boolean("auto_fix_force").notNull().default(false),
    autoMerge: boolean("auto_merge").notNull().default(false),
    // How a fix or update is checked before its PR: "typecheck" (tsc, needs
    // no database), "build" (build + tests — only for apps that build without
    // a database) or "none" (the repository's CI decides alone).
    verifyMode: text("verify_mode", { enum: ["typecheck", "build", "none"] })
      .notNull()
      .default("typecheck"),
    autoDeploy: boolean("auto_deploy").notNull().default(false),
    // When a deploy breaks the live site (or its build fails), go back to the
    // previous version: Dokploy's rollback when it has one, else a revert
    // commit of the merge on the default branch. Off by default.
    autoRollback: boolean("auto_rollback").notNull().default(false),
    // Restart the app through Dokploy when its site stays down.
    autoHeal: boolean("auto_heal").notNull().default(false),
    // Failed live checks in a row — two open an incident.
    liveFailures: integer("live_failures").notNull().default(0),
    dokployApplicationId: text("dokploy_application_id"),
    // What the id above addresses: a Dokploy application or a compose stack.
    dokployKind: text("dokploy_kind", { enum: ["application", "compose"] })
      .notNull()
      .default("application"),
    // The application's Docker service name in Dokploy (= its image name).
    // Ties the containers a server reports — and their image CVEs — to this
    // repository. Filled from the Dokploy API, never typed.
    dokployAppName: text("dokploy_app_name"),
    // The Coolify application instead, when the site runs on Coolify.
    coolifyAppUuid: text("coolify_app_uuid"),
    // Database migrations: risky setups, and what open PRs or undeployed
    // commits would do to the data (services/migration-guard.ts).
    migrationCheck: jsonb("migration_check"),
    // Any further platform (Komodo, Portainer): which one, and its id for the
    // stack or app — one pair instead of columns per platform.
    platformKind: text("platform_kind"),
    platformAppId: text("platform_app_id"),
    // Cron expression, null = no schedule. New repositories: every night.
    scanSchedule: text("scan_schedule").default("0 3 * * *"),
    packageManager: text("package_manager", {
      enum: ["npm", "pnpm", "yarn"],
    }), // null = auto-detect from lockfile
    // Where this repository is actually deployed. Triggering a deploy only
    // proves the platform accepted the request, so without a URL to look at
    // nothing here can tell whether a fix went live. The last result is kept
    // on the row so the UI can show it without re-probing on every render.
    liveUrl: text("live_url"),
    liveStatus: text("live_status", { enum: ["up", "down"] }),
    liveHttpStatus: integer("live_http_status"),
    liveCommit: text("live_commit"), // reported by the target, when it does
    liveError: text("live_error"),
    liveCheckedAt: timestamp("live_checked_at"),
    // Last seen tip of the default branch on GitHub, and the commit seen in
    // production — when either moves, the matching scan runs by itself.
    branchHead: text("branch_head"),
    deployedCommit: text("deployed_commit"),
    changesCheckedAt: timestamp("changes_checked_at"),
    // Every open pull request on GitHub (people, Dependabot, Package
    // Checker), refreshed with the change watch.
    openPrs: jsonb("open_prs"),
    // Payload / Next.js / React / Node of the default branch, from the last
    // scan — the version overview across all sites.
    stack: jsonb("stack"),
    // The `checks` object the health endpoint reports (booleans and
    // timestamps only, e.g. { email: true, storage: false }) — what the app
    // says about its own configuration.
    liveChecks: jsonb("live_checks"),
    // Required environment variables present in the Dokploy application —
    // names only, never values. See services/config-check.
    configCheck: jsonb("config_check"),
    // Read-only checks of the live site from outside (exposed files, open
    // Payload endpoints, security headers). See services/site-probe.
    siteProbe: jsonb("site_probe"),
    // The server this application runs on. Lets the server's live-facing
    // findings (Nuclei against the live URL, Uptime Kuma monitors) be shown
    // where they matter: on the application they describe.
    serverId: uuid("server_id").references((): AnyPgColumn => servers.id, {
      onDelete: "set null",
    }),
    // The agency's customer this site belongs to (reports, client view).
    clientId: uuid("client_id").references((): AnyPgColumn => clients.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("repositories_organization_id_idx").on(table.organizationId),
  ]
);

export const scans = pgTable("scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: text("status", {
    enum: ["pending", "running", "success", "failed"],
  })
    .notNull()
    .default("pending"),
  currentStep: text("current_step"),
  errorMessage: text("error_message"),
  // Written every minute while the scan's process is alive. A scan whose
  // heartbeat stopped lost its process (restart, deploy, out of memory).
  heartbeatAt: timestamp("heartbeat_at"),
  // What was scanned. "default" = the repository's branch (what the code says
  // today), "live" = the exact commit the deployment reports (what is actually
  // running out there). `ref` records the branch name or SHA either way.
  target: text("target", { enum: ["default", "live"] })
    .notNull()
    .default("default"),
  ref: text("ref"),
  // Why this scan has no vulnerability data, when it has none. An empty CVE
  // list otherwise reads as "audited, nothing found" — which is the most
  // dangerous thing a security tool can imply by accident.
  auditNote: text("audit_note"),
});

export const packageFindings = pgTable("package_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  scanId: uuid("scan_id")
    .notNull()
    .references(() => scans.id, { onDelete: "cascade" }),
  packageName: text("package_name").notNull(),
  currentVersion: text("current_version").notNull(),
  latestVersion: text("latest_version").notNull(),
  wantedVersion: text("wanted_version"),
  isDevDependency: boolean("is_dev_dependency").notNull().default(false),
  unused: boolean("unused").notNull().default(false),
});

export const updateRuns = pgTable("update_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  branchName: text("branch_name").notNull(),
  status: text("status", {
    enum: [
      "created",
      "updating",
      "build_running",
      "pushed",
      "pr_opened",
      "merged",
      "deploying",
      "deployed",
      "failed",
      // The PR was closed on GitHub without merging.
      "closed",
    ],
  })
    .notNull()
    .default("created"),
  // "manual" = the plain dependency-bump flow; "security" = CVE auto-fix flow.
  kind: text("kind", { enum: ["manual", "security"] })
    .notNull()
    .default("manual"),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  // Fine-grained phase within `status` ("clone", "install", "build", …), so
  // the UI can show progress during the minutes a run spends inside one status.
  currentStep: text("current_step"),
  buildOk: boolean("build_ok"),
  logOutput: text("log_output"),
  aiFixApplied: boolean("ai_fix_applied").default(false),
  scanId: uuid("scan_id").references(() => scans.id, { onDelete: "set null" }),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  merged: boolean("merged").notNull().default(false),
  // The commit the merge created on the default branch — what a rollback
  // reverts.
  mergeSha: text("merge_sha"),
  // Written every minute while the run's process works on it (or waits for
  // the build slot). Stops when the process dies.
  heartbeatAt: timestamp("heartbeat_at"),
  // Did a second audit after the fix actually show the advisories gone?
  // null = not checked (older runs, or the audit could not run at all).
  // A green build proves it compiles, not that the vulnerability is fixed.
  securityVerified: boolean("security_verified"),
  securitySummary: text("security_summary"),
});

// One row per advisory (per package) found by `npm audit` during a scan.
export const vulnerabilities = pgTable(
  "vulnerabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    packageName: text("package_name").notNull(),
    severity: text("severity", {
      enum: ["critical", "high", "moderate", "low", "info"],
    }).notNull(),
    ghsaId: text("ghsa_id"),
    cveId: text("cve_id"),
    title: text("title"),
    url: text("url"),
    vulnerableRange: text("vulnerable_range"),
    patchedVersion: text("patched_version"),
    fixAvailable: boolean("fix_available").notNull().default(false),
    fixIsSemverMajor: boolean("fix_is_semver_major").notNull().default(false),
    isDirect: boolean("is_direct").notNull().default(false),
    cvssScore: text("cvss_score"),
  },
  (table) => [index("vulnerabilities_scan_id_idx").on(table.scanId)]
);

// Records a Dokploy deploy trigger. Note: Dokploy exposes no reliable
// completion poll, so "triggered" means the POST was accepted, not "live".
export const deployRuns = pgTable(
  "deploy_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    updateRunId: uuid("update_run_id").references(() => updateRuns.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["triggered", "succeeded", "failed"],
    })
      .notNull()
      .default("triggered"),
    dokployApplicationId: text("dokploy_application_id"),
    triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    errorMessage: text("error_message"),
    // Outcome of watching the repository's live URL after the trigger:
    // null = not watched (no live URL configured), true = the URL answered
    // again, false = it never came back within the watch window.
    liveOk: boolean("live_ok"),
    liveDetail: text("live_detail"),
    liveVerifiedAt: timestamp("live_verified_at"),
    // What the deploy guard did after the watch: "healthy", "build_failed",
    // "broken", "error_spike" (healthy, then errors jumped), "rolled_back",
    // "rollback_failed". null = not guarded.
    guard: text("guard"),
    guardDetail: text("guard_detail"),
  },
  (table) => [index("deploy_runs_repository_id_idx").on(table.repositoryId)]
);

// One integration-config row per organization. Secret fields are stored
// AES-256-GCM encrypted (see lib/crypto.ts) and never returned in plaintext.
export const orgIntegrations = pgTable("org_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  githubToken: text("github_token"), // encrypted
  // A GitHub App created from Settings (manifest flow): its credentials,
  // private key and webhook secret encrypted, and where it is installed.
  githubApp: jsonb("github_app").$type<{
    id: number;
    slug: string;
    name: string;
    htmlUrl: string;
    clientId: string;
    clientSecret: string;
    privateKey: string;
    webhookSecret: string | null;
    installations: Array<{ id: number; account: string; type: string }>;
  }>(),
  // Installed platform versions against their security advisories
  // (services/platform-watch.ts).
  platformWatch: jsonb("platform_watch"),
  // The manifest flow's one-time state: "<token>.<created ms>".
  githubAppState: text("github_app_state"),
  // GitLab, Gitea/Forgejo and Bitbucket — cloud or self-hosted, one entry
  // per host. Each token encrypted on its own.
  gitHosts: jsonb("git_hosts")
    .$type<
      Array<{
        id: string;
        kind: "gitlab" | "gitea" | "bitbucket";
        url: string;
        username: string | null;
        token: string;
      }>
    >()
    .notNull()
    .default([]),
  dokployBaseUrl: text("dokploy_base_url"),
  coolifyBaseUrl: text("coolify_base_url"),
  // Observability: events out (OTLP, Grafana annotations, webhook) and
  // alerts in. Tokens and headers encrypted.
  otlpEndpoint: text("otlp_endpoint"),
  otlpHeaders: text("otlp_headers"), // encrypted, "Key: value" per line
  grafanaUrl: text("grafana_url"),
  grafanaToken: text("grafana_token"), // encrypted
  eventWebhookUrl: text("event_webhook_url"), // encrypted
  // Secret part of the alert receiver's URL (stored hashed).
  alertTokenHash: text("alert_token_hash"),
  coolifyToken: text("coolify_token"), // encrypted
  komodoBaseUrl: text("komodo_base_url"),
  komodoApiKey: text("komodo_api_key"), // encrypted
  komodoApiSecret: text("komodo_api_secret"), // encrypted
  portainerBaseUrl: text("portainer_base_url"),
  portainerToken: text("portainer_token"), // encrypted
  dokployToken: text("dokploy_token"), // encrypted
  slackWebhookUrl: text("slack_webhook_url"),
  telegramBotToken: text("telegram_bot_token"), // encrypted
  telegramChatId: text("telegram_chat_id"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"), // encrypted
  smtpFrom: text("smtp_from"),
  notifyEmailTo: text("notify_email_to"),
  // Uptime Kuma: base URL + API key for its /metrics endpoint.
  kumaBaseUrl: text("kuma_base_url"),
  kumaApiKey: text("kuma_api_key"), // encrypted
  // Every monitor from the last pull, assigned to a server or not — the
  // per-server state only holds the ones attached there.
  kumaState: jsonb("kuma_state"),
  // Wazuh manager API. The CA certificate is public data, not a secret: it
  // lets a self-signed manager be verified instead of skipping TLS checks.
  wazuhApiUrl: text("wazuh_api_url"),
  wazuhUser: text("wazuh_user"),
  wazuhPassword: text("wazuh_password"), // encrypted
  wazuhCaCert: text("wazuh_ca_cert"),
  // Hetzner Cloud read-only API tokens, one per project, newline-separated
  // and encrypted as one value. Used to read firewall rules only.
  hetznerTokens: text("hetzner_tokens"), // encrypted
  hetznerState: jsonb("hetzner_state"),
  // Language of notifications (Slack, Telegram, email).
  notifyLanguage: text("notify_language", { enum: ["en", "de"] })
    .notNull()
    .default("en"),
  // Google PageSpeed Insights API key (free) for Lighthouse runs.
  pagespeedApiKey: text("pagespeed_api_key"), // encrypted
  // Weekly summary: on by default, last sent (so restarts do not resend).
  weeklyDigest: boolean("weekly_digest").notNull().default(true),
  lastDigestAt: timestamp("last_digest_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * A machine we watch. Nothing here grants access to it: the agent on the
 * server pushes reports in with a per-server token, so this app never holds
 * SSH keys or credentials that could be used to reach the servers.
 */
export const servers = pgTable(
  "servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    clientId: uuid("client_id").references((): AnyPgColumn => clients.id, {
      onDelete: "set null",
    }),
    // SHA-256 of the agent token. The token itself is shown once and never
    // stored, so a database leak does not let anyone report as a server.
    agentTokenHash: text("agent_token_hash").unique(),
    agentTokenPrefix: text("agent_token_prefix"),
    agentTokenCreatedAt: timestamp("agent_token_created_at"),
    // One-time enrollment code for the install command: short-lived, single
    // use, exchanged by the installer for the permanent agent token. Lets the
    // command carry its own credential without that credential lasting.
    enrollmentCodeHash: text("enrollment_code_hash").unique(),
    enrollmentExpiresAt: timestamp("enrollment_expires_at"),
    lastReportAt: timestamp("last_report_at"),
    lastFullReportAt: timestamp("last_full_report_at"),
    // The most recent host snapshot as reported (normalized), for display.
    lastReport: jsonb("last_report"),
    agentVersion: text("agent_version"),
    hostname: text("hostname"),
    os: text("os"),
    // Extra Nuclei targets beyond the live URLs of linked repositories.
    nucleiTargets: jsonb("nuclei_targets")
      .$type<string[]>()
      .notNull()
      .default([]),
    nucleiSchedule: text("nuclei_schedule"), // cron, null = manual only
    // Uptime Kuma monitors (by name) that belong to this server.
    kumaMonitors: jsonb("kuma_monitors")
      .$type<string[]>()
      .notNull()
      .default([]),
    wazuhAgentId: text("wazuh_agent_id"),
    // Public IP or hostname, checked from the outside without an agent:
    // which ports answer, and is the TLS certificate in order.
    address: text("address"),
    expectedPorts: jsonb("expected_ports")
      .$type<number[]>()
      .notNull()
      .default([80, 443]),
    networkState: jsonb("network_state"),
    // Accepted SSH keys, privileged group members and uid-0 accounts. Anything
    // the agent reports beyond this is a finding until someone accepts it.
    accessBaseline: jsonb("access_baseline"),
    // The cloud firewall in front of the server (Hetzner), as last read.
    providerFirewall: jsonb("provider_firewall"),
    // Each app's usual memory and CPU (7-day median), refreshed hourly from
    // container_metrics — what "unusually high" is measured against.
    workloadBaseline: jsonb("workload_baseline"),
    // Last pull from Uptime Kuma / Wazuh, kept apart from the agent report
    // because they are written by different jobs.
    kumaState: jsonb("kuma_state"),
    wazuhState: jsonb("wazuh_state"),
    // Overload thresholds, in percent (load is per CPU core).
    // Backups the agent checks for freshness: newest file under `path` must
    // be younger than `maxAgeHours`. The agent only reads metadata.
    backupChecks: jsonb("backup_checks")
      .$type<Array<{ name: string; path: string; maxAgeHours: number }>>()
      .notNull()
      .default([]),
    cpuThreshold: integer("cpu_threshold").notNull().default(90),
    memoryThreshold: integer("memory_threshold").notNull().default(90),
    diskThreshold: integer("disk_threshold").notNull().default(85),
    // Object storage and folders to watch. With a path: a folder the agent
    // measures (any S3 server, or none). Without: a storage the agent found
    // by itself (MinIO in Docker), named as it reports it. limitGb warns
    // before the store outgrows what it may use.
    storageChecks: jsonb("storage_checks")
      .$type<
        Array<{ name: string; path: string | null; limitGb: number | null }>
      >()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("servers_organization_id_idx").on(table.organizationId)]
);

/**
 * Every problem on a server, whatever found it, in one table. A finding is
 * open while its source keeps reporting it and resolved the first time the
 * source reports without it — so "is it still there?" is always answered by
 * the latest data, not by someone remembering to close a ticket.
 */
export const serverFindings = pgTable(
  "server_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    // Set when the finding is about a specific application's live URL.
    repositoryId: uuid("repository_id").references(() => repositories.id, {
      onDelete: "set null",
    }),
    source: text("source", {
      enum: [
        "host",
        "trivy",
        "crowdsec",
        "nuclei",
        "kuma",
        "wazuh",
        "heartbeat",
        "network",
        "security",
        "provider",
        "dokploy",
        "registry",
        "coolify",
        "platform",
      ],
    }).notNull(),
    // Stable identity within the source, used to recognise the same problem
    // across reports (e.g. "CVE-2024-1234|openssl|/" for Trivy).
    fingerprint: text("fingerprint").notNull(),
    severity: text("severity", {
      enum: ["critical", "high", "medium", "low", "info"],
    }).notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    // What is affected: a package, a container image, a URL, a mount point.
    target: text("target"),
    reference: text("reference"), // http(s) URL only, validated on ingest
    fixAvailable: boolean("fix_available"),
    // When the server's own automation (unattended-upgrades, a scheduled
    // reboot) will take care of this — so it needs watching, not action.
    autoFixAt: timestamp("auto_fix_at"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    uniqueIndex("server_findings_identity_idx").on(
      table.serverId,
      table.source,
      table.fingerprint
    ),
    index("server_findings_server_open_idx").on(
      table.serverId,
      table.resolvedAt
    ),
    index("server_findings_repository_idx").on(table.repositoryId),
  ]
);

/** Load/memory/disk over time, so overload is visible as a trend. */
export const serverMetrics = pgTable(
  "server_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    // Load average (1 min) divided by the CPU count, in percent.
    cpuPct: real("cpu_pct"),
    memoryPct: real("memory_pct"),
    // The fullest filesystem.
    diskPct: real("disk_pct"),
    pendingUpdates: integer("pending_updates"),
    securityUpdates: integer("security_updates"),
  },
  (table) => [
    index("server_metrics_server_time_idx").on(
      table.serverId,
      table.recordedAt
    ),
  ]
);

/**
 * One Lighthouse run of a live site (PageSpeed Insights): lab scores and
 * metrics, plus Chrome's field data (real visitors) when Google has it.
 */
export const perfRuns = pgTable(
  "perf_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    url: text("url").notNull(),
    strategy: text("strategy", { enum: ["mobile", "desktop"] }).notNull(),
    trigger: text("trigger", { enum: ["schedule", "deploy", "manual"] })
      .notNull()
      .default("schedule"),
    commit: text("commit"),
    error: text("error"),
    // Lighthouse category scores, 0–100.
    performance: integer("performance"),
    accessibility: integer("accessibility"),
    bestPractices: integer("best_practices"),
    seo: integer("seo"),
    // Lab metrics.
    lcpMs: integer("lcp_ms"),
    cls: real("cls"),
    tbtMs: integer("tbt_ms"),
    fcpMs: integer("fcp_ms"),
    ttfbMs: integer("ttfb_ms"),
    bytes: integer("bytes"),
    // Field data (75th percentile of real Chrome users), when available.
    fieldLcpMs: integer("field_lcp_ms"),
    fieldInpMs: integer("field_inp_ms"),
    fieldCls: real("field_cls"),
  },
  (table) => [
    index("perf_runs_repo_time_idx").on(table.repositoryId, table.createdAt),
  ]
);

/**
 * Memory and CPU per app (a Swarm service, compose service or container),
 * one row per agent report — the history behind "uses 3× its usual RAM".
 */
export const containerMetrics = pgTable(
  "container_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    memBytes: bigint("mem_bytes", { mode: "number" }).notNull(),
    // Docker's CPU percent: 100 = one core fully busy.
    cpuPct: real("cpu_pct"),
  },
  (table) => [
    index("container_metrics_server_app_time_idx").on(
      table.serverId,
      table.app,
      table.recordedAt
    ),
    index("container_metrics_time_idx").on(table.recordedAt),
  ]
);

/**
 * How full each disk and each object storage was, once an hour — the
 * history behind "full in about 9 days". key: "disk:<mount>" or
 * "storage:<name>".
 */
export const storageMetrics = pgTable(
  "storage_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull(),
    totalBytes: bigint("total_bytes", { mode: "number" }),
  },
  (table) => [
    index("storage_metrics_server_key_time_idx").on(
      table.serverId,
      table.key,
      table.recordedAt
    ),
    index("storage_metrics_time_idx").on(table.recordedAt),
  ]
);

/** One Nuclei run against a server's live-facing targets. */
export const serverScanRuns = pgTable(
  "server_scan_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    tool: text("tool", { enum: ["nuclei"] })
      .notNull()
      .default("nuclei"),
    status: text("status", {
      enum: ["pending", "running", "success", "failed"],
    })
      .notNull()
      .default("pending"),
    targets: jsonb("targets").$type<string[]>().notNull().default([]),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    findingCount: integer("finding_count"),
    // Live progress from nuclei's JSON stats while the run is going.
    progress: jsonb("progress"),
    errorMessage: text("error_message"),
    log: text("log"),
  },
  (table) => [index("server_scan_runs_server_idx").on(table.serverId)]
);

/**
 * Who did what, when, from where — for the actions that hand out access,
 * change what runs unattended or where secrets go. Values of secrets are
 * never recorded, only which ones changed.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id"),
    userEmail: text("user_email"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetName: text("target_name"),
    detail: jsonb("detail"),
    ip: text("ip"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_org_time_idx").on(table.organizationId, table.createdAt),
    index("audit_log_user_idx").on(table.userId),
  ]
);

/**
 * API keys for the MCP endpoint. Shown once, stored as SHA-256. Read-only
 * unless created with the "scan" scope, which may only start scans.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["read"]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [index("api_keys_org_idx").on(table.organizationId)]
);

/** The agency's customers: what their sites, servers and domains add up to. */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Who the monthly report is for.
    contactEmail: text("contact_email"),
    // Language of what the client sees (the monthly report).
    language: text("language", { enum: ["de", "en"] })
      .notNull()
      .default("de"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("clients_organization_id_idx").on(table.organizationId)]
);

/**
 * A domain the agency is responsible for: certificate, registration and
 * mail DNS (SPF, DKIM, DMARC) checked daily. Created from live URLs, or
 * added by hand.
 */
export const domains = pgTable(
  "domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    source: text("source", { enum: ["auto", "manual"] })
      .notNull()
      .default("auto"),
    checkedAt: timestamp("checked_at"),
    state: jsonb("state"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("domains_org_name_idx").on(table.organizationId, table.name),
  ]
);

/**
 * One kind of error an app logs (same message, numbers and ids aside), as
 * the agent reports it: scrubbed of credentials, e-mail and IP addresses.
 */
export const logErrors = pgTable(
  "log_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    // The repository whose app logged it, when known (Dokploy service name).
    repositoryId: uuid("repository_id").references(() => repositories.id, {
      onDelete: "set null",
    }),
    app: text("app").notNull(),
    fingerprint: text("fingerprint").notNull(),
    sample: text("sample").notNull(),
    total: integer("total").notNull().default(0),
    firstSeen: timestamp("first_seen").notNull().defaultNow(),
    lastSeen: timestamp("last_seen").notNull().defaultNow(),
    // A notification went out for this one (new and frequent).
    notifiedAt: timestamp("notified_at"),
  },
  (table) => [
    uniqueIndex("log_errors_server_fp_idx").on(
      table.serverId,
      table.fingerprint
    ),
    index("log_errors_repo_idx").on(table.repositoryId, table.lastSeen),
  ]
);

/** How often each error came, per agent report — the history behind a spike. */
export const logErrorCounts = pgTable(
  "log_error_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    errorId: uuid("error_id")
      .notNull()
      .references(() => logErrors.id, { onDelete: "cascade" }),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    count: integer("count").notNull(),
  },
  (table) => [
    index("log_error_counts_error_time_idx").on(
      table.errorId,
      table.recordedAt
    ),
    index("log_error_counts_time_idx").on(table.recordedAt),
  ]
);

/**
 * A site that was down: from the second failed live check until it answers
 * again — with what Moatline did in between. The source of uptime.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["site_down", "alert", "check"] })
      .notNull()
      .default("site_down"),
    // For alerts: the alert's own identity (fingerprint), to resolve it.
    externalId: text("external_id"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    // The first error the check saw, and likely causes from the logs.
    cause: text("cause"),
    // [{ at, text }] — down, restart, escalation, back up.
    timeline: jsonb("timeline").notNull().default([]),
    healAttempts: integer("heal_attempts").notNull().default(0),
    healedAt: timestamp("healed_at"),
    escalatedAt: timestamp("escalated_at"),
  },
  (table) => [
    index("incidents_repo_time_idx").on(table.repositoryId, table.startedAt),
    index("incidents_org_open_idx").on(table.organizationId, table.resolvedAt),
  ]
);

/**
 * "New site": GitHub repository, Dokploy app, database, backup, domain and
 * monitoring created in one go. Each step's state is kept so the UI can
 * follow along; no secret values are stored, only which keys were set.
 */
export const provisionRuns = pgTable(
  "provision_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    // [{ key, label, status: pending|running|done|skipped|failed, detail }]
    steps: jsonb("steps").notNull().default([]),
    // Non-secret input, for the record (names, ids, env keys — no values).
    input: jsonb("input"),
    repositoryId: uuid("repository_id").references(() => repositories.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [index("provision_runs_org_idx").on(table.organizationId)]
);

/**
 * The cloud plan of an organization, mirrored from Stripe's webhooks. No
 * row: the free plan. Self-hosted instances (no Stripe configured) never
 * read it.
 */
export const billingAccounts = pgTable("billing_accounts", {
  organizationId: text("organization_id").primaryKey(),
  customerId: text("customer_id"),
  subscriptionId: text("subscription_id"),
  // Stripe's status: active, trialing, past_due, unpaid, canceled …
  status: text("status"),
  // Servers paid for (the subscription item's quantity) — per-server
  // subscriptions only; a plan is one flat item.
  quantity: integer("quantity").notNull().default(0),
  // "solo" | "team" | "agency", or "per-server" for the old price.
  plan: text("plan"),
  periodEndsAt: timestamp("period_ends_at"),
  // A pending cancellation or pause: { action, effectiveAt }.
  scheduledChange: jsonb("scheduled_change"),
  // Newest webhook applied — older ones arriving late are ignored.
  eventAt: timestamp("event_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Webhook events already applied, so a retry is not applied twice. */
export const billingEvents = pgTable("billing_events", {
  eventId: text("event_id").primaryKey(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

/**
 * A user journey checked against a site's live URL: HTTP steps with
 * expected status and text, cookies carried from step to step (logins).
 * Secret values (a test user's password) are stored encrypted, apart from
 * the steps, and never shown in results.
 */
export const syntheticChecks = pgTable(
  "synthetic_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // [{ method, path, body?, contentType?, expectStatus?, expectText?, maxMs? }]
    steps: jsonb("steps").notNull(),
    // Encrypted JSON object of ${variables} the steps use.
    secrets: text("secrets"),
    intervalMinutes: integer("interval_minutes").notNull().default(15),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at"),
    lastOk: boolean("last_ok"),
    // Per step: status, ms, ok, error — no bodies, no secrets.
    lastResult: jsonb("last_result"),
    failures: integer("failures").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("synthetic_checks_repo_idx").on(table.repositoryId)]
);

/**
 * What each probe (a check from another location) last saw of a live URL.
 * One row per site and probe: an outage is only confirmed when a second
 * location sees it too.
 */
export const probeResults = pgTable(
  "probe_results",
  {
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    probe: text("probe").notNull(),
    ok: boolean("ok").notNull(),
    httpStatus: integer("http_status"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    checkedAt: timestamp("checked_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.probe] })]
);

/** A public status page: chosen sites, their uptime and incidents. */
export const statusPages = pgTable(
  "status_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** /status/<slug>, unique across the instance. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** The sites shown, in this order: [{ repositoryId, name }]. */
    components: jsonb("components")
      .$type<Array<{ repositoryId: string; name: string }>>()
      .notNull()
      .default([]),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("status_pages_slug_idx").on(t.slug)]
);

/**
 * A scheduled job that reports in: it calls its URL after every run, and
 * silence longer than its period plus grace is an alarm.
 */
export const cronChecks = pgTable(
  "cron_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The secret part of its ping URL. */
    token: text("token").notNull(),
    periodSeconds: integer("period_seconds").notNull(),
    graceSeconds: integer("grace_seconds").notNull(),
    /** new: never pinged; up; down. */
    status: text("status", { enum: ["new", "up", "down"] })
      .notNull()
      .default("new"),
    lastPingAt: timestamp("last_ping_at"),
    lastStartAt: timestamp("last_start_at"),
    downSince: timestamp("down_since"),
    /** The last pings: [{ at, kind: "ok" | "fail" | "start", ms? }]. */
    pings: jsonb("pings")
      .$type<
        Array<{ at: string; kind: "ok" | "fail" | "start"; ms?: number }>
      >()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cron_checks_token_idx").on(t.token),
    index("cron_checks_org_idx").on(t.organizationId),
  ]
);

/**
 * Planned work: alerts for the organization, a server or a repository are
 * held back, and status pages say "maintenance" instead of "down".
 */
export const maintenanceWindows = pgTable(
  "maintenance_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scope: text("scope", {
      enum: ["organization", "server", "repository"],
    }).notNull(),
    /** The server or repository; null for the whole organization. */
    targetId: text("target_id"),
    reason: text("reason"),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("maintenance_org_end_idx").on(t.organizationId, t.endsAt)]
);
