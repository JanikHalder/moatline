import { z } from "zod";
import {
  deploysBefore,
  newKills,
  oomFindings,
  type OomEvent,
} from "./oom-events";
import { and, eq, isNull } from "drizzle-orm";
import { db, serverFindings, serverMetrics, servers } from "db";
import { maybeAutoCleanDocker } from "./docker-auto-clean";
import {
  syncAndNotify,
  syncFindings,
  type FindingInput,
} from "../lib/server-findings";
import {
  accessIdentities,
  securityFindings,
  securitySectionsSchema,
  type AccessBaseline,
} from "./security-findings";
import type { NetworkState } from "./network-check";
import type { ProviderFirewall } from "./hetzner";
import { repoForApp, reposByAppName } from "./dokploy-sync";
import { ingestLogErrors } from "./log-errors";
import {
  currentBaseline,
  recordContainerMetrics,
  usageFindings,
  type ContainerUsage,
  type WorkloadBaseline,
} from "./workload-usage";
import { osSupport } from "../lib/os-support";
import {
  buildForecast,
  loadGrowth,
  recordStorageMetrics,
  storageFindings,
  storageOnDisk,
  type StorageCheck,
} from "./storage-watch";

/**
 * What the agent (agent/pc-agent.py) sends. Everything is bounded: the
 * endpoint is reachable from the internet, so a stolen token must not be
 * enough to fill the database or the UI with arbitrary amounts of data.
 */
const str = (max: number) => z.string().max(max);
const optStr = (max: number) => z.string().max(max).nullish();
const num = z.number().finite();

/** One line of `docker system df`: size and what is unused. */
const dfPart = z.object({
  sizeBytes: z.number().nonnegative(),
  reclaimableBytes: z.number().nonnegative(),
});

const diskSchema = z.object({
  mount: str(300),
  fsType: optStr(50),
  totalBytes: num.nonnegative(),
  usedBytes: num.nonnegative(),
});

const updatePackageSchema = z.object({
  name: str(200),
  current: optStr(100),
  candidate: optStr(100),
  security: z.boolean().optional(),
});

const crowdsecSchema = z.object({
  available: z.boolean(),
  error: optStr(500),
  bouncers: z
    .array(
      z.object({
        name: str(200),
        type: optStr(200),
        lastPull: optStr(50),
        valid: z.boolean().nullish(),
      })
    )
    .max(100)
    .default([]),
  activeDecisions: num.int().nonnegative().nullish(),
  alerts24h: num.int().nonnegative().nullish(),
  topScenarios: z
    .array(z.object({ scenario: str(200), count: num.int().nonnegative() }))
    .max(20)
    .default([]),
});

const trivyVulnSchema = z.object({
  id: str(100),
  pkg: str(200),
  installed: optStr(100),
  fixed: optStr(300),
  severity: str(20),
  title: optStr(500),
  url: optStr(1000),
});

const trivySchema = z.object({
  available: z.boolean(),
  error: optStr(1000),
  results: z
    .array(
      z.object({
        // "rootfs" for the host itself, otherwise an image reference.
        target: str(500),
        kind: z.enum(["host", "image"]),
        // Containers running from this image, when kind = image.
        containers: z.array(str(200)).max(100).default([]),
        vulnerabilities: z.array(trivyVulnSchema).max(5000),
      })
    )
    .max(100)
    .default([]),
});

export const agentReportSchema = z.object({
  v: z.literal(1),
  agentVersion: str(50),
  sentAt: z.string().datetime({ offset: true }),
  kind: z.enum(["metrics", "full"]),
  host: z.object({
    hostname: str(255),
    os: optStr(255),
    kernel: optStr(255),
    // Agent 1.12.0+
    dockerVersion: optStr(50),
    // Agent 1.15.0+: the kernel's OOM kills.
    oom: z
      .object({
        kills: num.int().nonnegative().nullish(),
        victims: z
          .array(
            z.object({
              at: optStr(40),
              pid: num.int().nonnegative(),
              process: str(64),
            })
          )
          .max(20),
      })
      .nullish(),
    uptimeSeconds: num.nonnegative().nullish(),
    cpuCount: num.int().positive().max(4096),
    load: z.tuple([num, num, num]),
    // Agent 1.8.0+: real utilization since the last report, % of all cores.
    cpu: z
      .object({
        usagePct: num.min(0).max(100),
        iowaitPct: num.min(0).max(100),
        stealPct: num.min(0).max(100),
      })
      .nullish(),
    memory: z.object({
      totalBytes: num.nonnegative(),
      availableBytes: num.nonnegative(),
    }),
    swap: z
      .object({ totalBytes: num.nonnegative(), freeBytes: num.nonnegative() })
      .nullish(),
    disks: z.array(diskSchema).max(100),
  }),
  updates: z
    .object({
      manager: str(20),
      pending: num.int().nonnegative(),
      security: num.int().nonnegative(),
      packages: z.array(updatePackageSchema).max(500).default([]),
      rebootRequired: z.boolean().nullish(),
      rebootRequiredSince: z.string().datetime({ offset: true }).nullish(),
      rebootPackages: z.array(str(200)).max(50).nullish(),
      unattended: z
        .object({
          lastRunAt: z.string().datetime({ offset: true }).nullish(),
          lastResult: z.enum(["ok", "error", "unknown"]).nullish(),
          lastError: optStr(500),
          nextRunAt: z.string().datetime({ offset: true }).nullish(),
          rebootScheduledAt: z.string().datetime({ offset: true }).nullish(),
        })
        .nullish(),
      autoUpdates: z.boolean().nullish(),
      autoReboot: z
        .object({
          enabled: z.boolean(),
          time: optStr(20),
          withUsers: z.boolean().nullish(),
          usersLoggedIn: num.int().nonnegative().nullish(),
        })
        .nullish(),
      listsAgeHours: num.nonnegative().nullish(),
      error: optStr(500),
    })
    .nullish(),
  crowdsec: crowdsecSchema.nullish(),
  trivy: trivySchema.nullish(),
  ...securitySectionsSchema,
  containers: z
    .array(
      z.object({
        name: str(200),
        image: str(500),
        status: optStr(200),
        state: optStr(50),
        health: z.enum(["healthy", "unhealthy", "starting"]).nullish(),
        // Agent 1.6.0+
        app: optStr(200),
        memBytes: num.nonnegative().nullish(),
        memLimit: num.nonnegative().nullish(),
        cpuPct: num.nonnegative().nullish(),
        oomKilled: z.boolean().nullish(),
        restartCount: num.int().nonnegative().nullish(),
        startedAt: optStr(64),
        // Agent 1.10.0+: when the image was built and its registry digest.
        imageCreated: optStr(50),
        imageDigest: optStr(100),
      })
    )
    .max(500)
    .nullish(),
  services: z
    .array(
      z.object({
        name: str(200),
        running: num.int().nonnegative(),
        desired: num.int().nonnegative(),
        mode: optStr(50),
      })
    )
    .max(500)
    .nullish(),
  // Agent 1.13.0+: Tailscale, when installed.
  tailscale: z
    .object({
      state: optStr(40),
      online: z.boolean().nullish(),
      ips: z.array(str(64)).max(4).default([]),
      hostname: optStr(120),
      keyExpiry: optStr(40),
      // Agent 1.16.0+: Tailscale SSH on; SSH let in only on tailscale0.
      ssh: z.boolean().nullish(),
      sshTailnetOnly: z.boolean().nullish(),
    })
    .nullish(),
  // Agent 1.11.0+: error lines from container logs, scrubbed and grouped.
  logErrors: z
    .object({
      errors: z
        .array(
          z.object({
            fingerprint: z.string().regex(/^[0-9a-f]{8,40}$/),
            app: str(200),
            container: optStr(200),
            sample: str(500),
            count: num.int().positive().max(1_000_000),
            firstAt: optStr(40),
            lastAt: optStr(40),
          })
        )
        .max(200),
    })
    .nullish(),
  dockerDisk: z
    .object({
      images: dfPart.nullish(),
      buildCache: dfPart.nullish(),
      containers: dfPart.nullish(),
      volumes: dfPart.nullish(),
      measuredAt: z.string().datetime({ offset: true }).nullish(),
    })
    .nullish(),
  // Agent 1.14.0+: object storage found in Docker and folders to watch,
  // measured hourly.
  storage: z
    .object({
      items: z
        .array(
          z.object({
            name: str(200),
            kind: str(40),
            container: optStr(200),
            paths: z.array(str(300)).max(10),
            sizeBytes: num.nonnegative().nullish(),
            folders: z
              .array(z.object({ name: str(200), sizeBytes: num.nonnegative() }))
              .max(50)
              .default([]),
            disk: z
              .object({
                mount: str(300),
                totalBytes: num.nonnegative(),
                usedBytes: num.nonnegative(),
              })
              .nullish(),
            error: optStr(300),
          })
        )
        .max(50),
      measuredAt: z.string().datetime({ offset: true }).nullish(),
    })
    .nullish(),
  backups: z
    .array(
      z.object({
        name: str(100),
        path: str(500),
        newestAt: z.string().datetime({ offset: true }).nullish(),
        sizeBytes: num.nonnegative().nullish(),
        error: optStr(200),
      })
    )
    .max(20)
    .nullish(),
});

export type AgentReport = z.infer<typeof agentReportSchema>;

/** Reports older (or newer) than this are rejected as replays / bad clocks. */
export const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

export function isFresh(sentAt: string, now = Date.now()): boolean {
  const t = new Date(sentAt).getTime();
  return Number.isFinite(t) && Math.abs(now - t) <= MAX_CLOCK_SKEW_MS;
}

type Thresholds = {
  cpuThreshold: number;
  memoryThreshold: number;
  diskThreshold: number;
};

export function hostPercentages(host: AgentReport["host"]): {
  /** CPU in use, % of all cores — real utilization when the agent sends it. */
  cpuPct: number;
  cpu5Pct: number;
  /** Load average per core, %. Counts processes waiting for the disk too. */
  loadPct: number;
  /** cpuPct is measured utilization, not derived from the load average. */
  measured: boolean;
  memoryPct: number;
  disks: Array<{ mount: string; pct: number; totalBytes: number }>;
  diskPct: number | null;
} {
  const cpus = Math.max(1, host.cpuCount);
  const memoryPct =
    host.memory.totalBytes > 0
      ? ((host.memory.totalBytes - host.memory.availableBytes) /
          host.memory.totalBytes) *
        100
      : 0;
  const disks = host.disks
    .filter((d) => d.totalBytes > 0)
    .map((d) => ({
      mount: d.mount,
      totalBytes: d.totalBytes,
      pct: (d.usedBytes / d.totalBytes) * 100,
    }));
  const loadPct = (host.load[0] / cpus) * 100;
  // Utilization covers the ~5 minutes since the previous report, so it
  // serves as the smoothed value too.
  const usage = host.cpu?.usagePct;
  return {
    cpuPct: usage ?? loadPct,
    cpu5Pct: usage ?? (host.load[1] / cpus) * 100,
    loadPct,
    measured: usage != null,
    memoryPct,
    disks,
    diskPct: disks.length ? Math.max(...disks.map((d) => d.pct)) : null,
  };
}

const pct = (n: number) => `${Math.round(n)}%`;

const GB = 1e9;
const gb = (n: number) =>
  n >= 10 * GB ? `${Math.round(n / GB)} GB` : `${(n / GB).toFixed(1)} GB`;

/** Where the upgrade guide lives (landing page docs). */
const OS_GUIDE = "https://moatline.dev/guide/os-upgrade";
const TAILSCALE_GUIDE = "https://moatline.dev/guide/tailscale";

/**
 * An operating system past its end of support gets no security updates any
 * more — whatever unattended-upgrades does. The finding says how to get off
 * it, including keeping the server's IP.
 */
export function osFindings(
  report: AgentReport,
  now = Date.now()
): FindingInput[] {
  const os = osSupport(report.host.os, now);
  if (os.status !== "eol" && os.status !== "soon") return [];
  const ubuntu = os.name.startsWith("Ubuntu");
  const next = ubuntu ? "Ubuntu 24.04 LTS" : "Debian 13";
  return [
    {
      fingerprint: `os-eol:${os.name}`,
      severity: os.status === "eol" ? "high" : "medium",
      title:
        os.status === "eol"
          ? `${os.name} gets no security updates since ${os.eol}`
          : `${os.name} support ends on ${os.eol}`,
      detail: [
        `Move to ${next}. Safest: a new server with ${next}, apps moved over (with Dokploy: add it as a server, redeploy there, restore the databases), then the old one switched off — on Hetzner Cloud the primary IP can move to the new server, so DNS stays as it is.`,
        ubuntu
          ? "In place: take a snapshot, then `sudo do-release-upgrade` one release at a time (20.04 → 22.04 → 24.04) and re-enable third-party repositories (Docker, CrowdSec) with the new codename."
          : "In place: take a snapshot, then upgrade one release at a time (change the codename in the APT sources, `apt full-upgrade`, reboot).",
        `Step by step: ${OS_GUIDE}`,
      ].join(" "),
      target: "os",
      reference: OS_GUIDE,
    },
  ];
}

/**
 * A server that falls off the tailnet is unreachable for whoever reaches it
 * only that way: Tailscale logged out, or its key about to expire.
 */
export function tailscaleFindings(
  report: AgentReport,
  now = Date.now()
): FindingInput[] {
  const ts = report.tailscale;
  if (!ts) return [];
  if (ts.state && ts.state !== "Running")
    return [
      {
        fingerprint: "tailscale:down",
        severity: "high",
        title: `Tailscale is not connected (${ts.state})`,
        detail:
          "The server is off the tailnet — SSH or reports over Tailscale fail. Run `tailscale up` on it, or the agent install with --tailscale.",
        target: "tailscale",
      },
    ];
  const out = tailscaleSshFindings(ts);
  const expiry = ts.keyExpiry ? Date.parse(ts.keyExpiry) : NaN;
  if (!Number.isFinite(expiry) || new Date(expiry).getUTCFullYear() < 2000)
    return out;
  const days = Math.floor((expiry - now) / DAY);
  if (days > 14) return out;
  return [
    ...out,
    {
      fingerprint: "tailscale:key-expiry",
      severity: days < 0 ? "high" : "medium",
      title:
        days < 0
          ? "Tailscale key has expired"
          : `Tailscale key expires in ${days} ${days === 1 ? "day" : "days"}`,
      detail:
        "Then the server drops off the tailnet. In the Tailscale admin console, turn off key expiry for this server (Machines → … → Disable key expiry), or re-authenticate it.",
      target: "tailscale",
    },
  ];
}

/**
 * How SSH reaches a server on the tailnet decides whether tools that log in
 * with a key — Dokploy and Coolify for their remote servers, CI deploys —
 * still get in. Not a fault: a note on what has to be set up for it, since
 * the usual symptom is only "Dokploy cannot connect" with nothing pointing
 * here.
 */
function tailscaleSshFindings(
  ts: NonNullable<AgentReport["tailscale"]>
): FindingInput[] {
  const ip =
    ts.ips?.find((a) => /^100\./.test(a)) ?? ts.ips?.[0] ?? "100.x.y.z";
  const out: FindingInput[] = [];
  if (ts.ssh)
    out.push({
      fingerprint: "tailscale:ssh",
      severity: "info",
      title:
        "Tailscale SSH is on — SSH keys do not count on the tailnet address",
      detail: `On ${ip}, port 22, Tailscale answers instead of sshd and the tailnet's ACLs decide who gets in. A tool that logs in with an SSH key (Dokploy, Coolify, a CI deploy) is turned away unless an ACL rule with "action": "accept" lets its machine in — "check" asks for a browser login no tool can do. Either turn Tailscale SSH off on this server (\`sudo tailscale set --ssh=false\`; the key works again over the tailnet), or allow the tool's machine in the Tailscale ACLs.`,
      target: "tailscale",
      reference: TAILSCALE_GUIDE,
    });
  if (ts.sshTailnetOnly)
    out.push({
      fingerprint: "tailscale:ssh-tailnet-only",
      severity: "info",
      title: "SSH is open only over Tailscale",
      detail: `The firewall lets SSH in only on the tailnet. Tools that connect to the public IP (Dokploy, Coolify, CI deploys) no longer get through: their machine has to join the tailnet and connect to ${ip}.`,
      target: "tailscale",
      reference: TAILSCALE_GUIDE,
    });
  return out;
}

/** What a cleanup would free: build cache and unused images. Never volumes. */
export function dockerReclaimable(report: AgentReport): {
  buildCache: number;
  images: number;
  total: number;
} {
  const d = report.dockerDisk;
  const buildCache = d?.buildCache?.reclaimableBytes ?? 0;
  const images = d?.images?.reclaimableBytes ?? 0;
  return { buildCache, images, total: buildCache + images };
}

/**
 * Overload, full disks, pending updates — turned into findings so they share
 * the lifecycle (open → resolved) and the notifications of everything else.
 */
/** What the server's automation will do next, if it works. */
export type AutoUpdatePlan = {
  /** unattended-upgrades is on, ran recently and without errors. */
  healthy: boolean;
  /** When its next run installs pending security updates. */
  nextRunAt: Date | null;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Pending security updates this long mean the automation is not working. */
export const SECURITY_STUCK_AFTER_MS = 48 * HOUR;
/** A run older than this means unattended-upgrades stopped running. */
const UNATTENDED_SILENT_AFTER_MS = 48 * HOUR;
/** A reboot pending this long without being scheduled needs a human. */
const REBOOT_OVERDUE_AFTER_MS = 3 * DAY;

export function autoUpdatePlan(
  report: AgentReport,
  now = Date.now()
): AutoUpdatePlan {
  const u = report.updates;
  const ua = u?.unattended;
  if (!u?.autoUpdates || !ua) return { healthy: false, nextRunAt: null };
  const last = ua.lastRunAt ? new Date(ua.lastRunAt).getTime() : NaN;
  const next = ua.nextRunAt ? new Date(ua.nextRunAt) : null;
  const ranRecently =
    Number.isFinite(last) && now - last < UNATTENDED_SILENT_AFTER_MS;
  const healthy = ranRecently && ua.lastResult !== "error";
  return {
    healthy,
    // Only promise a fix that is due within a day; anything further out is
    // not "it will sort itself out".
    nextRunAt:
      healthy && next && next.getTime() - now < 26 * HOUR ? next : null,
  };
}

/** Why a needed reboot is not happening, as precisely as the agent knows. */
function rebootReason(
  ar: NonNullable<AgentReport["updates"]>["autoReboot"]
): string {
  if (!ar)
    return "Nothing has scheduled it: enable Automatic-Reboot (Setup tab → Automatic updates) or reboot by hand.";
  if (!ar.enabled)
    return "Automatic reboots are off (Unattended-Upgrade::Automatic-Reboot). Run the command under Setup → Automatic updates, or reboot by hand.";
  if (ar.withUsers === false && (ar.usersLoggedIn ?? 0) > 0)
    return `Automatic reboots are on, but blocked while users are logged in (${ar.usersLoggedIn} session(s) now — often a forgotten SSH session). Set Automatic-Reboot-WithUsers "true" or close the sessions.`;
  return `Automatic reboots are on${ar.time ? ` (at ${ar.time})` : ""} but did not happen — check \`journalctl -u unattended-upgrades\` and /var/log/unattended-upgrades/.`;
}

function days(ms: number): number {
  return Math.max(1, Math.round(ms / DAY));
}

export function hostFindings(
  report: AgentReport,
  thresholds: Thresholds,
  ctx: { securityPendingSince?: Date | null; now?: number } = {}
): FindingInput[] {
  const now = ctx.now ?? Date.now();
  const plan = autoUpdatePlan(report, now);
  const out: FindingInput[] = [];
  const p = hostPercentages(report.host);

  // Averaged over ~5 minutes: a one-minute spike from a cron job is not
  // overload, and alerting on it teaches people to ignore the alert.
  const cpu = report.host.cpu;
  if (p.cpu5Pct >= thresholds.cpuThreshold) {
    out.push({
      fingerprint: "load",
      severity: p.cpu5Pct >= (p.measured ? 98 : 150) ? "critical" : "high",
      title: p.measured
        ? `CPU overloaded: ${pct(p.cpu5Pct)} of ${report.host.cpuCount} cores in use`
        : `CPU overloaded: load ${report.host.load[1].toFixed(2)} on ${report.host.cpuCount} cores`,
      detail: p.measured
        ? `Average over the last ~5 minutes (threshold ${thresholds.cpuThreshold}%). Load average ${report.host.load[1].toFixed(2)}.`
        : `5-minute load average is ${pct(p.cpu5Pct)} of capacity (threshold ${thresholds.cpuThreshold}%). The load also counts processes waiting for the disk — agent 1.8.0 reports the real CPU use.`,
      target: "cpu",
    });
  }
  // Load far above what the CPU does: processes stuck waiting for the disk.
  if (cpu && cpu.iowaitPct >= 30) {
    out.push({
      fingerprint: "iowait",
      severity: "medium",
      title: `Disk is the bottleneck: ${pct(cpu.iowaitPct)} of CPU time waiting for I/O`,
      detail: `CPU in use: ${pct(cpu.usagePct)}, load average ${report.host.load[1].toFixed(2)} on ${report.host.cpuCount} cores. Usually a backup, an image pull or a build; if it lasts, check the volume (Hetzner volumes are network storage) and \`iotop\`.`,
      target: "disk",
    });
  }
  if (cpu && cpu.stealPct >= 20) {
    out.push({
      fingerprint: "steal",
      severity: "medium",
      title: `${pct(cpu.stealPct)} of CPU time taken by the hypervisor (steal)`,
      detail: `The cloud host gives this VM less CPU than it asks for — noisy neighbours on a shared-vCPU plan. Dedicated vCPU (Hetzner CCX) avoids it.`,
      target: "cpu",
    });
  }
  if (p.memoryPct >= thresholds.memoryThreshold) {
    out.push({
      fingerprint: "memory",
      severity: p.memoryPct >= 97 ? "critical" : "high",
      title: `Memory almost exhausted: ${pct(p.memoryPct)} used`,
      detail: `Threshold ${thresholds.memoryThreshold}%. Processes may be killed by the OOM killer.`,
      target: "memory",
    });
  }
  const free = dockerReclaimable(report);
  const freeNote =
    free.total >= GB
      ? ` Docker can free ${gb(free.total)} (build cache ${gb(free.buildCache)}, unused images ${gb(free.images)}) — server → Overview → Docker storage.`
      : "";
  for (const d of p.disks) {
    if (d.pct < thresholds.diskThreshold) continue;
    const onIt = storageOnDisk(report, d.mount);
    out.push({
      fingerprint: `disk:${d.mount}`,
      severity: d.pct >= 95 ? "critical" : "high",
      title: `Disk ${d.mount} is ${pct(d.pct)} full`,
      detail: `Threshold ${thresholds.diskThreshold}%. A full disk stops databases, logs and deployments.${d.mount === "/" ? freeNote : ""}${onIt ? ` ${onIt}` : ""}`,
      target: d.mount,
    });
  }
  out.push(...tailscaleFindings(report, now));
  out.push(...osFindings(report, now));

  // Before the disk is full: a lot of it is only leftovers of old builds.
  const root = p.disks.find((d) => d.mount === "/") ?? p.disks[0];
  if (
    free.total >= 10 * GB ||
    (root &&
      root.totalBytes &&
      free.total >= 0.25 * root.totalBytes &&
      free.total >= 2 * GB)
  ) {
    out.push({
      fingerprint: "docker:reclaimable",
      severity: root && root.pct >= 70 ? "medium" : "low",
      title: `Docker keeps ${gb(free.total)} of unused build cache and images`,
      detail: `Build cache ${gb(free.buildCache)}, unused images ${gb(free.images)}. Old builds pile up with every deploy until the disk is full — clear them under server → Overview → Docker storage.`,
      target: "docker",
    });
  }

  const u = report.updates;
  if (u) {
    if (u.error) {
      out.push({
        fingerprint: "updates:error",
        severity: "medium",
        title: "Pending updates could not be determined",
        detail: u.error,
        target: u.manager,
      });
    }
    if (u.security > 0) {
      const names = u.packages
        .filter((x) => x.security)
        .slice(0, 30)
        .map((x) => x.name);
      out.push({
        fingerprint: "updates:security",
        // Due in tonight's (or today's) run: worth seeing, not worth a page.
        severity: plan.nextRunAt ? "medium" : "high",
        title: `${u.security} security ${u.security === 1 ? "update" : "updates"} pending`,
        detail:
          [
            names.length ? names.join(", ") : null,
            plan.nextRunAt
              ? "Installed automatically by the next unattended-upgrades run."
              : u.autoUpdates
                ? "Automatic updates are not working — see the other findings — so these will not install on their own."
                : "Automatic updates are off: install them by hand (`unattended-upgrade -v`).",
          ]
            .filter(Boolean)
            .join("\n") || null,
        target: u.manager,
        autoFixAt: plan.nextRunAt,
      });
      const since = ctx.securityPendingSince?.getTime();
      if (since && now - since > SECURITY_STUCK_AFTER_MS) {
        out.push({
          fingerprint: "updates:stuck",
          severity: "high",
          title: `Security updates pending for ${days(now - since)} days`,
          detail:
            "unattended-upgrades should have installed them by now. Check `tail -50 /var/log/unattended-upgrades/unattended-upgrades.log` and `unattended-upgrade --dry-run -d` — typical causes are held packages, an interrupted dpkg (`dpkg --configure -a`) or packages on the blacklist.",
          target: u.manager,
        });
      }
    }
    const ua = u.unattended;
    if (u.autoUpdates && ua) {
      const last = ua.lastRunAt ? new Date(ua.lastRunAt).getTime() : NaN;
      if (!Number.isFinite(last)) {
        out.push({
          fingerprint: "unattended:never",
          severity: "medium",
          title: "Automatic updates are on, but have never run",
          detail:
            "No run in /var/log/unattended-upgrades/unattended-upgrades.log. Check `systemctl list-timers apt-daily-upgrade.timer`.",
        });
      } else if (now - last > UNATTENDED_SILENT_AFTER_MS) {
        out.push({
          fingerprint: "unattended:silent",
          severity: "high",
          title: `Automatic updates have not run for ${days(now - last)} days`,
          detail:
            "apt-daily-upgrade.timer is probably disabled or failing: `systemctl status apt-daily-upgrade.timer apt-daily-upgrade.service`.",
        });
      }
      if (ua.lastResult === "error") {
        out.push({
          fingerprint: "unattended:error",
          severity: "high",
          title: "The last automatic update run failed",
          detail:
            ua.lastError ??
            "See /var/log/unattended-upgrades/unattended-upgrades.log.",
        });
      }
    }
    const other = u.pending - u.security;
    if (other > 0) {
      out.push({
        fingerprint: "updates:pending",
        severity: "low",
        title: `${other} ${other === 1 ? "update" : "updates"} pending`,
        target: u.manager,
      });
    }
    if (u.rebootRequired) {
      const since = u.rebootRequiredSince
        ? new Date(u.rebootRequiredSince).getTime()
        : NaN;
      const scheduled = u.unattended?.rebootScheduledAt
        ? new Date(u.unattended.rebootScheduledAt)
        : null;
      const overdue =
        !scheduled &&
        Number.isFinite(since) &&
        now - since > REBOOT_OVERDUE_AFTER_MS;
      const pkgs = u.rebootPackages?.length
        ? `Needed by: ${u.rebootPackages.join(", ")}.`
        : null;
      out.push({
        fingerprint: "reboot-required",
        severity: overdue ? "high" : scheduled ? "low" : "medium",
        title: scheduled
          ? "Reboot scheduled"
          : overdue
            ? `Reboot pending for ${days(now - since)} days`
            : "Reboot required",
        detail: [
          "Updates were installed that only take effect after a reboot (e.g. a new kernel or libc). Until then the old, possibly vulnerable version keeps running.",
          pkgs,
          overdue ? rebootReason(u.autoReboot) : null,
        ]
          .filter(Boolean)
          .join("\n"),
        autoFixAt: scheduled,
      });
    }
    if (u.autoUpdates === false) {
      out.push({
        fingerprint: "auto-updates-off",
        severity: "low",
        title: "Automatic security updates are off",
        detail:
          "unattended-upgrades is not enabled. Security patches only arrive when someone installs them by hand.",
      });
    }
    if (u.listsAgeHours != null && u.listsAgeHours > 72) {
      out.push({
        fingerprint: "updates:stale-lists",
        severity: "low",
        title: `Package lists are ${Math.round(u.listsAgeHours / 24)} days old`,
        detail:
          "The pending-update count is only as current as the package lists. Enable apt-daily or run `apt-get update` regularly.",
      });
    }
  }
  return out;
}

type BackupCheck = { name: string; path: string; maxAgeHours: number };

/**
 * Containers and Swarm services that are not doing their job, and backups
 * that stopped arriving — the failures nobody notices until they matter.
 */
export function workloadFindings(
  report: AgentReport,
  ctx: {
    /** Services degraded in the previous report (deploys briefly read 0/1). */
    previouslyDegraded?: Set<string>;
    backupChecks?: BackupCheck[];
    now?: number;
  } = {}
): FindingInput[] {
  const now = ctx.now ?? Date.now();
  const out: FindingInput[] = [];
  for (const c of report.containers ?? []) {
    if (c.health === "unhealthy") {
      out.push({
        fingerprint: `container:unhealthy:${c.name}`,
        severity: "high",
        title: `Container ${c.name} is unhealthy`,
        detail: `Its health check fails (${c.status ?? "no status"}). Check \`docker logs ${c.name}\`.`,
        target: c.image,
      });
    }
    if (c.state === "restarting") {
      out.push({
        fingerprint: `container:restarting:${c.name}`,
        severity: "high",
        title: `Container ${c.name} keeps restarting`,
        detail:
          `${c.status ?? ""} — it crashes on start. Check \`docker logs ${c.name}\`.`.trim(),
        target: c.image,
      });
    }
  }
  for (const s of report.services ?? []) {
    if (s.desired === 0 || s.running >= s.desired) continue;
    // One degraded report is a deploy in progress; two in a row is an outage.
    if (!ctx.previouslyDegraded?.has(s.name)) continue;
    out.push({
      fingerprint: `service:${s.name}`,
      severity: s.running === 0 ? "critical" : "high",
      title:
        s.running === 0
          ? `Service ${s.name} is down (0/${s.desired})`
          : `Service ${s.name} is degraded (${s.running}/${s.desired})`,
      detail: `Check \`docker service ps ${s.name} --no-trunc\` for why its tasks do not start.`,
    });
  }
  const results = new Map((report.backups ?? []).map((b) => [b.name, b]));
  for (const check of ctx.backupChecks ?? []) {
    const r = results.get(check.name);
    const fp = `backup:${check.name}`;
    if (!r) continue; // the agent has not picked the check up yet
    if (r.error || !r.newestAt) {
      out.push({
        fingerprint: fp,
        severity: "high",
        title: `Backup "${check.name}": ${r.error ?? "no files found"}`,
        detail: `Nothing found at ${check.path}.`,
        target: check.path,
      });
      continue;
    }
    const ageMs = now - new Date(r.newestAt).getTime();
    const maxMs = check.maxAgeHours * HOUR;
    if (ageMs > maxMs) {
      out.push({
        fingerprint: fp,
        severity: ageMs > 3 * maxMs ? "critical" : "high",
        title: `Backup "${check.name}" is ${Math.round(ageMs / HOUR)} hours old`,
        detail: `Newest file under ${check.path} is from ${r.newestAt}; expected one at least every ${check.maxAgeHours} hours.`,
        target: check.path,
      });
    }
  }
  return out;
}

/** CrowdSec health as findings. Attacks themselves are stats, not problems. */
export function crowdsecFindings(
  cs: NonNullable<AgentReport["crowdsec"]>,
  now = Date.now()
): FindingInput[] {
  if (!cs.available) {
    return [
      {
        fingerprint: "unavailable",
        severity: "high",
        title: "CrowdSec is not running or not installed",
        detail:
          cs.error ??
          "cscli was not found or the local API did not answer. Attacks on this server are neither detected nor blocked.",
      },
    ];
  }
  const out: FindingInput[] = [];
  if (cs.error) {
    out.push({
      fingerprint: "error",
      severity: "medium",
      title: "CrowdSec status could not be read completely",
      detail: cs.error,
    });
  }
  if (cs.bouncers.length === 0) {
    out.push({
      fingerprint: "no-bouncer",
      severity: "high",
      title: "No CrowdSec bouncer registered",
      detail:
        "CrowdSec detects attacks, but without a bouncer (e.g. crowdsec-firewall-bouncer) its decisions are never enforced — nothing is blocked.",
    });
  }
  for (const b of cs.bouncers) {
    const last = b.lastPull ? new Date(b.lastPull).getTime() : NaN;
    const stale = !Number.isFinite(last) || now - last > 60 * 60 * 1000;
    if (b.valid === false || stale) {
      out.push({
        fingerprint: `bouncer:${b.name}`,
        severity: "medium",
        title: `Bouncer "${b.name}" is not pulling decisions`,
        detail: b.lastPull
          ? `Last pull ${b.lastPull}. Blocks decided since then are not enforced.`
          : "It never pulled decisions.",
        target: b.type ?? null,
      });
    }
  }
  return out;
}

/**
 * "linux-modules-6.8.0-139-generic" → "6.8.0-139". Kernel packages carry
 * their version in the name; several can be installed, only one runs.
 */
export function kernelPackageVersion(pkg: string): string | null {
  const m = pkg.match(
    /^linux-(?:image|modules|modules-extra|headers|tools|cloud-tools|buildinfo|objects)(?:-unsigned)?-(\d+\.\d+\.\d+-\d+)/
  );
  return m ? m[1]! : null;
}

export function trivyFindings(
  trivy: NonNullable<AgentReport["trivy"]>,
  ctx: {
    /** `uname -r`, e.g. "6.8.0-142-generic". */
    runningKernel?: string | null;
    /** Host packages with a security update the automation will install. */
    autoUpdated?: Set<string>;
    autoFixAt?: Date | null;
    /** The repository an image belongs to (via its Dokploy service). */
    repoForImage?: (image: string, containers: string[]) => string | null;
  } = {}
): FindingInput[] {
  if (!trivy.available) {
    return [
      {
        fingerprint: "unavailable",
        severity: "medium",
        title: "Trivy did not run — vulnerabilities on this host are unknown",
        detail:
          trivy.error ??
          "trivy was not found on the server. Install it so OS packages and container images are checked.",
      },
    ];
  }
  const out: FindingInput[] = [];
  if (trivy.error) {
    out.push({
      fingerprint: "error",
      severity: "medium",
      title: "Trivy scan was incomplete",
      detail: trivy.error,
    });
  }
  for (const r of trivy.results) {
    const where =
      r.kind === "host"
        ? "host"
        : `${r.target}${r.containers.length ? ` (${r.containers.join(", ")})` : ""}`;
    const repositoryId =
      r.kind === "image"
        ? (ctx.repoForImage?.(r.target, r.containers) ?? null)
        : null;
    for (const v of r.vulnerabilities) {
      const kernel = r.kind === "host" ? kernelPackageVersion(v.pkg) : null;
      // An installed kernel that is not booted cannot be exploited; it is
      // clutter left for `apt autoremove`, not an open critical.
      const inactiveKernel =
        !!kernel &&
        !!ctx.runningKernel &&
        !ctx.runningKernel.startsWith(kernel);
      const autoFix =
        r.kind === "host" &&
        !!v.fixed &&
        !!ctx.autoFixAt &&
        !!ctx.autoUpdated?.has(v.pkg);
      out.push({
        fingerprint: `${r.kind}|${r.target}|${v.pkg}|${v.id}`,
        severity: inactiveKernel
          ? "low"
          : (v.severity.toLowerCase() as FindingInput["severity"]),
        title: `${v.id} in ${v.pkg}${v.installed ? ` ${v.installed}` : ""}${inactiveKernel ? " (kernel not running)" : ""}`,
        detail: [
          v.title,
          v.fixed ? `Fixed in ${v.fixed}.` : "No fixed version available yet.",
          inactiveKernel
            ? `This kernel is installed but not booted (running: ${ctx.runningKernel}). Remove it with \`apt autoremove --purge\`.`
            : null,
          autoFix
            ? "The fix is installed automatically by the next unattended-upgrades run."
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
        target: where,
        reference: v.url ?? null,
        fixAvailable: !!v.fixed,
        autoFixAt: autoFix ? ctx.autoFixAt : null,
        repositoryId,
      });
    }
  }
  return out;
}

/** Summary of the last Trivy run, kept on the server row for display. */
function trivySummary(trivy: NonNullable<AgentReport["trivy"]>) {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const r of trivy.results) {
    for (const v of r.vulnerabilities) {
      const s = v.severity.toLowerCase();
      counts[s] = (counts[s] ?? 0) + 1;
      total++;
    }
  }
  return {
    available: trivy.available,
    error: trivy.error ?? null,
    targets: trivy.results.map((r) => ({
      target: r.target,
      kind: r.kind,
      containers: r.containers,
      count: r.vulnerabilities.length,
      severities: r.vulnerabilities.reduce<Record<string, number>>((acc, v) => {
        const s = v.severity.toLowerCase();
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      }, {}),
      fixable: r.vulnerabilities.filter(
        (v) =>
          !!v.fixed && ["CRITICAL", "HIGH"].includes(v.severity.toUpperCase())
      ).length,
    })),
    counts,
    total,
  };
}

type ServerRow = typeof servers.$inferSelect;

/** Store a report and bring the server's findings up to date with it. */
export async function ingestReport(
  server: ServerRow,
  report: AgentReport
): Promise<void> {
  const now = new Date();
  const p = hostPercentages(report.host);
  const previous = (server.lastReport ?? {}) as Record<string, unknown>;

  const lastReport = {
    receivedAt: now.toISOString(),
    kind: report.kind,
    host: {
      ...report.host,
      cpuPct: p.cpuPct,
      memoryPct: p.memoryPct,
      diskPct: p.diskPct,
    },
    updates: report.updates ?? null,
    crowdsec: report.crowdsec ?? null,
    containers: report.containers ?? previous.containers ?? null,
    services: report.services ?? null,
    backups: report.backups ?? null,
    hardening: report.hardening ?? null,
    access: report.access ?? null,
    staleLibraries: report.staleLibraries ?? null,
    listeners: report.listeners ?? null,
    dockerRisks: report.dockerRisks ?? null,
    dockerDisk: report.dockerDisk ?? previous.dockerDisk ?? null,
    storage: report.storage ?? previous.storage ?? null,
    storageForecast: null as unknown,
    oomEvent: (previous.oomEvent ?? null) as OomEvent | null,
    tailscale: report.tailscale ?? null,
    compromise: report.compromise ?? null,
    // A metrics report carries no Trivy data; keep the last full one.
    trivy: report.trivy
      ? { scannedAt: now.toISOString(), ...trivySummary(report.trivy) }
      : (previous.trivy ?? null),
  };

  // The server ran out of memory since the last report: when, what died,
  // and whether a deploy on this server was running.
  const killed = newKills(
    (previous.host as { oom?: { kills?: number | null } } | undefined)?.oom
      ?.kills,
    report.host.oom?.kills
  );
  if (killed > 0)
    lastReport.oomEvent = {
      at: now.toISOString(),
      count: killed,
      victims: (report.host.oom?.victims ?? []).map((v) => v.process),
      duringDeploy: await deploysBefore(server.id, now).catch(() => []),
    };

  // Disk and storage growth, from the hourly history.
  const storageChecks = (server.storageChecks ?? []) as StorageCheck[];
  await recordStorageMetrics(server.id, report, now).catch((e) =>
    console.error("[servers] storage metrics failed:", e)
  );
  const growth = await loadGrowth(server.id, now).catch(
    () => new Map<string, number>()
  );
  lastReport.storageForecast = buildForecast(report, storageChecks, growth);

  await db
    .update(servers)
    .set({
      lastReportAt: now,
      ...(report.kind === "full" ? { lastFullReportAt: now } : {}),
      lastReport,
      agentVersion: report.agentVersion,
      hostname: report.host.hostname,
      os: report.host.os ?? null,
    })
    .where(eq(servers.id, server.id));

  await db.insert(serverMetrics).values({
    serverId: server.id,
    recordedAt: now,
    cpuPct: round1(p.cpuPct),
    memoryPct: round1(p.memoryPct),
    diskPct: p.diskPct == null ? null : round1(p.diskPct),
    pendingUpdates: report.updates?.pending ?? null,
    securityUpdates: report.updates?.security ?? null,
  });

  // Memory and CPU per app, and what is usual for each.
  if (report.containers?.some((c) => c.memBytes != null)) {
    await recordContainerMetrics(server.id, report.containers, now);
  }
  const baseline = await currentBaseline(
    server.id,
    (server.workloadBaseline ?? null) as WorkloadBaseline | null,
    now
  );

  // Which repository each Dokploy service belongs to: image CVEs and
  // memory findings then show on the repository too.
  const repoByApp = await reposByAppName(server.organizationId);
  if (report.logErrors?.errors.length) {
    await ingestLogErrors(
      server,
      report.logErrors.errors,
      repoByApp,
      now
    ).catch((e) => console.error("[servers] log errors failed:", e));
  }
  const containers = (report.containers ??
    previous.containers ??
    []) as ContainerUsage[];

  // The agent is talking again — whatever said otherwise is resolved.
  await syncFindings(server.id, "heartbeat", []);
  // How long security updates have been pending: the open finding's age.
  const [pending] = await db
    .select({ firstSeenAt: serverFindings.firstSeenAt })
    .from(serverFindings)
    .where(
      and(
        eq(serverFindings.serverId, server.id),
        eq(serverFindings.source, "host"),
        eq(serverFindings.fingerprint, "updates:security"),
        isNull(serverFindings.resolvedAt)
      )
    )
    .limit(1);
  const prevServices = (previous.services ?? []) as Array<{
    name: string;
    running: number;
    desired: number;
  }>;
  await syncAndNotify(server.id, "host", [
    ...hostFindings(report, server, {
      securityPendingSince: pending?.firstSeenAt ?? null,
    }),
    ...workloadFindings(report, {
      previouslyDegraded: new Set(
        prevServices
          .filter((s) => s.desired > 0 && s.running < s.desired)
          .map((s) => s.name)
      ),
      backupChecks: server.backupChecks ?? [],
    }),
    ...storageFindings(report, storageChecks, growth, server.diskThreshold),
    ...oomFindings(lastReport.oomEvent, now.getTime()),
    ...usageFindings(report.containers ?? [], {
      baseline,
      hostMemBytes: report.host.memory?.totalBytes ?? null,
      previous: (previous.containers ?? null) as ContainerUsage[] | null,
      repoByApp,
    }),
  ]);
  // Agent 1.4.0+: hardening, access, Docker risks, signs of compromise.
  if (report.hardening || report.access || report.compromise) {
    let baseline = (server.accessBaseline ?? null) as AccessBaseline | null;
    if (!baseline && report.access) {
      // The first report defines what is known; changes after it alert.
      baseline = accessIdentities(report.access);
      await db
        .update(servers)
        .set({ accessBaseline: baseline })
        .where(eq(servers.id, server.id));
    }
    await syncAndNotify(
      server.id,
      "security",
      securityFindings(report, {
        baseline,
        networkState: (server.networkState ?? null) as NetworkState | null,
        providerFirewall: (server.providerFirewall ??
          null) as ProviderFirewall | null,
        expectedPorts: server.expectedPorts ?? [80, 443],
        crowdsecAvailable: report.crowdsec?.available,
        rebootRequired: !!report.updates?.rebootRequired,
        agentVersion: report.agentVersion,
      })
    );
  }
  if (report.crowdsec) {
    await syncAndNotify(
      server.id,
      "crowdsec",
      crowdsecFindings(report.crowdsec)
    );
  }
  if (report.trivy) {
    const plan = autoUpdatePlan(report);
    await syncAndNotify(
      server.id,
      "trivy",
      trivyFindings(report.trivy, {
        runningKernel: report.host.kernel ?? null,
        autoUpdated: new Set(
          (report.updates?.packages ?? [])
            .filter((x) => x.security)
            .map((x) => x.name)
        ),
        autoFixAt: plan.nextRunAt,
        repoForImage: (image, names) =>
          repoForImage(image, names, containers, repoByApp),
      })
    );
  }

  // Disk at/over threshold + reclaimable Docker junk → clear via Dokploy
  // (build cache + unused images only). Cooldown inside maybeAutoCleanDocker.
  void maybeAutoCleanDocker({ ...server, lastReport }, lastReport).catch((e) =>
    console.error("[servers] docker auto-clean failed:", e)
  );
}

/**
 * The repository behind an image: by the Dokploy service of a container
 * running it, else by the image name (Dokploy tags builds "<appName>:latest").
 */
export function repoForImage(
  image: string,
  containerNames: string[],
  containers: ContainerUsage[],
  repoByApp: Map<string, string>
): string | null {
  for (const name of containerNames) {
    const c = containers.find((x) => x.name === name);
    const app = c?.app || name.split(".")[0]!;
    const repo = repoForApp(app, repoByApp);
    if (repo) return repo;
  }
  const bare = image.replace(/^.*\//, "").replace(/[:@].*$/, "");
  return repoForApp(bare, repoByApp);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
