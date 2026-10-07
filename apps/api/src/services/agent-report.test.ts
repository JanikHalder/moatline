import { describe, it, expect, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  servers: {},
  serverMetrics: {},
  serverFindings: {},
}));

import {
  agentReportSchema,
  crowdsecFindings,
  hostFindings,
  hostPercentages,
  isFresh,
  repoForImage,
  trivyFindings,
  workloadFindings,
  type AgentReport,
  tailscaleFindings,
  osFindings,
} from "./agent-report";

const thresholds = { cpuThreshold: 90, memoryThreshold: 90, diskThreshold: 85 };

function report(overrides: Partial<AgentReport> = {}): AgentReport {
  return agentReportSchema.parse({
    v: 1,
    agentVersion: "1.0.0",
    sentAt: new Date().toISOString(),
    kind: "metrics",
    host: {
      hostname: "web-01",
      cpuCount: 4,
      load: [0.5, 0.5, 0.5],
      memory: { totalBytes: 8e9, availableBytes: 6e9 },
      disks: [{ mount: "/", totalBytes: 100e9, usedBytes: 40e9 }],
    },
    ...overrides,
  });
}

describe("hostFindings", () => {
  it("reports nothing for a healthy host", () => {
    expect(hostFindings(report(), thresholds)).toEqual([]);
  });

  it("points at Docker leftovers that fill the disk", () => {
    const docker = report({
      dockerDisk: {
        images: { sizeBytes: 40e9, reclaimableBytes: 30e9 },
        buildCache: { sizeBytes: 20e9, reclaimableBytes: 20e9 },
        volumes: { sizeBytes: 25e9, reclaimableBytes: 20e9 },
      },
      host: {
        hostname: "web-01",
        cpuCount: 4,
        load: [0.5, 0.5, 0.5],
        memory: { totalBytes: 8e9, availableBytes: 6e9 },
        disks: [{ mount: "/", totalBytes: 100e9, usedBytes: 90e9 }],
      },
    } as Partial<AgentReport>);
    const f = hostFindings(docker, thresholds);
    expect(f.find((x) => x.fingerprint === "disk:/")?.detail).toContain(
      "Docker can free 50 GB"
    );
    // Volumes hold data: never counted as reclaimable.
    expect(f.find((x) => x.fingerprint === "docker:reclaimable")).toMatchObject(
      {
        severity: "medium",
        title: "Docker keeps 50 GB of unused build cache and images",
      }
    );
  });

  it("uses the 5-minute load, so a one-minute spike is not overload", () => {
    const spike = report();
    spike.host.load = [8, 1, 1];
    expect(hostFindings(spike, thresholds)).toEqual([]);
    const sustained = report();
    sustained.host.load = [4, 4, 4];
    expect(hostFindings(sustained, thresholds)[0]).toMatchObject({
      fingerprint: "load",
      severity: "high",
    });
  });

  it("goes by measured CPU use, not the load, when the agent sends it", () => {
    // Load 6 on 4 cores (150 %) while the CPU mostly waits for the disk.
    const r = report();
    r.host.load = [6, 6, 6];
    r.host.cpu = { usagePct: 20, iowaitPct: 45, stealPct: 0 };
    const f = hostFindings(r, thresholds);
    expect(f.map((x) => x.fingerprint)).toEqual(["iowait"]);
    expect(hostPercentages(r.host)).toMatchObject({
      cpuPct: 20,
      loadPct: 150,
      measured: true,
    });
    r.host.cpu = { usagePct: 99, iowaitPct: 0, stealPct: 0 };
    expect(hostFindings(r, thresholds)[0]).toMatchObject({
      fingerprint: "load",
      severity: "critical",
      title: "CPU overloaded: 99% of 4 cores in use",
    });
  });

  it("flags full disks per mount and memory pressure", () => {
    const r = report();
    r.host.disks = [
      { mount: "/", totalBytes: 100, usedBytes: 96 },
      { mount: "/data", totalBytes: 100, usedBytes: 86 },
    ];
    r.host.memory = { totalBytes: 100, availableBytes: 5 };
    const f = hostFindings(r, thresholds);
    expect(f.map((x) => [x.fingerprint, x.severity])).toEqual([
      ["memory", "high"],
      ["disk:/", "critical"],
      ["disk:/data", "high"],
    ]);
  });

  it("turns pending security updates and a required reboot into findings", () => {
    const r = report({
      updates: {
        manager: "apt",
        pending: 4,
        security: 1,
        packages: [{ name: "openssl", security: true }],
        rebootRequired: true,
        autoUpdates: false,
      },
    });
    const f = hostFindings(r, thresholds);
    expect(f.map((x) => x.fingerprint)).toEqual([
      "updates:security",
      "updates:pending",
      "reboot-required",
      "auto-updates-off",
    ]);
    expect(f[0]!.detail).toContain("openssl");
  });
});

describe("crowdsecFindings", () => {
  it("treats a missing CrowdSec as a problem, not as silence", () => {
    expect(
      crowdsecFindings({ available: false, bouncers: [], topScenarios: [] })[0]
    ).toMatchObject({
      severity: "high",
    });
  });

  it("warns when nothing enforces the decisions", () => {
    const f = crowdsecFindings({
      available: true,
      bouncers: [],
      topScenarios: [],
    });
    expect(f.map((x) => x.fingerprint)).toEqual(["no-bouncer"]);
  });

  it("flags a bouncer that stopped pulling", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    const f = crowdsecFindings(
      {
        available: true,
        topScenarios: [],
        bouncers: [
          { name: "fw", lastPull: "2026-01-01T11:59:00Z", valid: true },
          { name: "old", lastPull: "2026-01-01T08:00:00Z", valid: true },
        ],
      },
      now
    );
    expect(f.map((x) => x.fingerprint)).toEqual(["bouncer:old"]);
  });
});

describe("trivyFindings", () => {
  it("reports a missing scanner instead of an empty (clean-looking) list", () => {
    expect(trivyFindings({ available: false, results: [] })).toHaveLength(1);
  });

  it("keys findings by target, package and advisory", () => {
    const f = trivyFindings({
      available: true,
      results: [
        {
          target: "ghcr.io/acme/app:1",
          kind: "image",
          containers: ["app"],
          vulnerabilities: [
            {
              id: "CVE-1",
              pkg: "next",
              installed: "14.0.0",
              fixed: "14.2.10",
              severity: "CRITICAL",
            },
          ],
        },
      ],
    });
    expect(f[0]).toMatchObject({
      fingerprint: "image|ghcr.io/acme/app:1|next|CVE-1",
      severity: "critical",
      target: "ghcr.io/acme/app:1 (app)",
      fixAvailable: true,
    });
  });
});

describe("isFresh", () => {
  it("rejects reports far in the past or future", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    expect(isFresh("2026-01-01T11:50:00Z", now)).toBe(true);
    expect(isFresh("2026-01-01T11:00:00Z", now)).toBe(false);
    expect(isFresh("2026-01-01T13:00:00Z", now)).toBe(false);
  });
});

describe("agentReportSchema", () => {
  it("bounds the size of what a token holder can submit", () => {
    const r = report();
    const tooMany = {
      ...r,
      host: {
        ...r.host,
        disks: Array.from({ length: 101 }, () => r.host.disks[0]),
      },
    };
    expect(agentReportSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("automatic updates", () => {
  const NOW = Date.parse("2026-10-01T18:00:00Z");
  const updates = (unattended: Record<string, unknown>, extra = {}) =>
    report({
      updates: {
        manager: "apt",
        pending: 2,
        security: 2,
        packages: [
          { name: "libssl3t64", security: true },
          { name: "openssl", security: true },
        ],
        autoUpdates: true,
        unattended,
        ...extra,
      },
    });
  const healthy = {
    lastRunAt: "2026-10-01T03:10:00Z",
    lastResult: "ok",
    nextRunAt: "2026-10-02T03:10:00Z",
  };

  it("treats updates the next run installs as watch, not act", () => {
    const f = hostFindings(updates(healthy), thresholds, { now: NOW });
    const sec = f.find((x) => x.fingerprint === "updates:security")!;
    expect(sec.severity).toBe("medium");
    expect(sec.autoFixAt?.toISOString()).toBe("2026-10-02T03:10:00.000Z");
  });

  it("raises an alarm when security updates stay pending for days", () => {
    const f = hostFindings(updates(healthy), thresholds, {
      now: NOW,
      securityPendingSince: new Date(NOW - 3 * 24 * 3600 * 1000),
    });
    expect(f.find((x) => x.fingerprint === "updates:stuck")).toMatchObject({
      severity: "high",
      title: "Security updates pending for 3 days",
    });
  });

  it("notices unattended-upgrades that stopped running or failed", () => {
    const silent = hostFindings(
      updates({ ...healthy, lastRunAt: "2026-09-27T03:10:00Z" }),
      thresholds,
      { now: NOW }
    );
    expect(silent.map((x) => x.fingerprint)).toContain("unattended:silent");
    // …and then no longer promises that it will fix anything.
    expect(
      silent.find((x) => x.fingerprint === "updates:security")
    ).toMatchObject({ severity: "high", autoFixAt: null });

    const failed = hostFindings(
      updates({ ...healthy, lastResult: "error", lastError: "dpkg broken" }),
      thresholds,
      { now: NOW }
    );
    expect(
      failed.find((x) => x.fingerprint === "unattended:error")
    ).toMatchObject({ severity: "high", detail: "dpkg broken" });
  });

  it("separates a scheduled reboot from one nobody will do", () => {
    const scheduled = hostFindings(
      updates(
        { ...healthy, rebootScheduledAt: "2026-10-02T04:00:00Z" },
        { rebootRequired: true, rebootRequiredSince: "2026-10-01T12:00:00Z" }
      ),
      thresholds,
      { now: NOW }
    ).find((x) => x.fingerprint === "reboot-required")!;
    expect(scheduled).toMatchObject({
      severity: "low",
      title: "Reboot scheduled",
    });

    const overdue = hostFindings(
      updates(healthy, {
        rebootRequired: true,
        rebootRequiredSince: "2026-09-25T12:00:00Z",
      }),
      thresholds,
      { now: NOW }
    ).find((x) => x.fingerprint === "reboot-required")!;
    expect(overdue).toMatchObject({
      severity: "high",
      title: "Reboot pending for 6 days",
    });
  });
});

describe("trivy and the running kernel", () => {
  const trivy = {
    available: true,
    results: [
      {
        target: "rootfs",
        kind: "host" as const,
        containers: [],
        vulnerabilities: [
          {
            id: "CVE-K",
            pkg: "linux-modules-6.8.0-139-generic",
            installed: "6.8.0-139.139",
            severity: "CRITICAL",
          },
          {
            id: "CVE-K",
            pkg: "linux-modules-6.8.0-142-generic",
            installed: "6.8.0-142.142",
            severity: "CRITICAL",
          },
          {
            id: "CVE-S",
            pkg: "libssl3t64",
            installed: "3.0.13-0ubuntu3.15",
            fixed: "3.0.13-0ubuntu3.16",
            severity: "HIGH",
          },
        ],
      },
    ],
  };

  it("downgrades kernels that are installed but not booted", () => {
    const f = trivyFindings(trivy, { runningKernel: "6.8.0-142-generic" });
    expect(f.map((x) => [x.severity, x.title])).toEqual([
      [
        "low",
        "CVE-K in linux-modules-6.8.0-139-generic 6.8.0-139.139 (kernel not running)",
      ],
      ["critical", "CVE-K in linux-modules-6.8.0-142-generic 6.8.0-142.142"],
      ["high", "CVE-S in libssl3t64 3.0.13-0ubuntu3.15"],
    ]);
  });

  it("marks fixes the next automatic run installs", () => {
    const at = new Date("2026-10-02T03:10:00Z");
    const f = trivyFindings(trivy, {
      runningKernel: "6.8.0-142-generic",
      autoUpdated: new Set(["libssl3t64"]),
      autoFixAt: at,
    });
    expect(f[2]!.autoFixAt).toBe(at);
    expect(f[1]!.autoFixAt).toBeNull();
  });
});

describe("workloadFindings", () => {
  const NOW = Date.parse("2026-10-01T18:00:00Z");
  const base = () =>
    report({
      containers: [
        {
          name: "web",
          image: "app:1",
          status: "Up 2h (unhealthy)",
          state: "running",
          health: "unhealthy",
        },
        {
          name: "worker",
          image: "app:1",
          status: "Restarting (1) 5s ago",
          state: "restarting",
        },
        {
          name: "ok",
          image: "app:1",
          status: "Up 2h (healthy)",
          state: "running",
          health: "healthy",
        },
      ],
      services: [
        { name: "shop", running: 0, desired: 1 },
        { name: "blog", running: 1, desired: 1 },
      ],
      backups: [
        { name: "db", path: "/backups/db", newestAt: "2026-09-29T18:00:00Z" },
        { name: "files", path: "/backups/files", error: "path not found" },
      ],
    });
  const checks = [
    { name: "db", path: "/backups/db", maxAgeHours: 24 },
    { name: "files", path: "/backups/files", maxAgeHours: 24 },
  ];

  it("flags unhealthy and crash-looping containers", () => {
    const f = workloadFindings(base(), { now: NOW });
    expect(f.map((x) => x.fingerprint)).toEqual([
      "container:unhealthy:web",
      "container:restarting:worker",
    ]);
  });

  it("only calls a service down when it was down in the previous report too", () => {
    expect(
      workloadFindings(base(), { now: NOW }).some(
        (x) => x.fingerprint === "service:shop"
      )
    ).toBe(false);
    expect(
      workloadFindings(base(), {
        now: NOW,
        previouslyDegraded: new Set(["shop"]),
      }).find((x) => x.fingerprint === "service:shop")
    ).toMatchObject({
      severity: "critical",
      title: "Service shop is down (0/1)",
    });
  });

  it("raises stale and missing backups", () => {
    const f = workloadFindings(base(), { now: NOW, backupChecks: checks });
    expect(f.find((x) => x.fingerprint === "backup:db")).toMatchObject({
      severity: "high",
      title: 'Backup "db" is 48 hours old',
    });
    expect(f.find((x) => x.fingerprint === "backup:files")).toMatchObject({
      severity: "high",
      title: 'Backup "files": path not found',
    });
  });
});

describe("reboot reason", () => {
  const NOW = Date.parse("2026-10-01T18:00:00Z");
  const r = (autoReboot: {
    enabled: boolean;
    time?: string;
    withUsers?: boolean;
    usersLoggedIn?: number;
  }) =>
    hostFindings(
      report({
        updates: {
          manager: "apt",
          pending: 0,
          security: 0,
          packages: [],
          autoUpdates: true,
          rebootRequired: true,
          rebootRequiredSince: "2026-09-24T12:00:00Z",
          autoReboot,
        },
      }),
      thresholds,
      { now: NOW }
    ).find((x) => x.fingerprint === "reboot-required")!.detail;

  it("says why the reboot does not happen", () => {
    expect(r({ enabled: false, withUsers: true })).toContain(
      "Automatic reboots are off"
    );
    expect(r({ enabled: true, withUsers: false, usersLoggedIn: 2 })).toContain(
      "blocked while users are logged in (2 session(s)"
    );
    expect(r({ enabled: true, time: "04:00", withUsers: true })).toContain(
      "(at 04:00) but did not happen"
    );
  });
});

describe("repoForImage", () => {
  const repos = new Map([["shop-abc123", "repo-1"]]);
  it("goes by the Dokploy service of the container running the image", () => {
    expect(
      repoForImage(
        "registry.example.com/shop:sha-1",
        ["shop-abc123.1.xyz"],
        [{ name: "shop-abc123.1.xyz", app: "shop-abc123" }],
        repos
      )
    ).toBe("repo-1");
  });
  it("falls back to Dokploy's image tag, and to nothing", () => {
    expect(repoForImage("shop-abc123:latest", [], [], repos)).toBe("repo-1");
    expect(repoForImage("postgres:17", ["db.1.x"], [], repos)).toBeNull();
  });
});

describe("repoForImage with compose stacks", () => {
  it("matches compose services by their stack prefix", () => {
    const repos = new Map([["shop-stack-9x", "repo-2"]]);
    expect(
      repoForImage(
        "postgres:17",
        ["shop-stack-9x-db-1"],
        [{ name: "shop-stack-9x-db-1", app: "shop-stack-9x-db" }],
        repos
      )
    ).toBe("repo-2");
  });
});

describe("tailscaleFindings", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const with_ = (tailscale: unknown) =>
    report({ tailscale } as Partial<AgentReport>);
  it("says nothing without Tailscale or with a key that does not expire", () => {
    expect(tailscaleFindings(report(), now)).toEqual([]);
    expect(
      tailscaleFindings(
        with_({ state: "Running", ips: [], keyExpiry: "0001-01-01T00:00:00Z" }),
        now
      )
    ).toEqual([]);
  });
  it("warns before the key expires and when it has", () => {
    expect(
      tailscaleFindings(
        with_({ state: "Running", ips: [], keyExpiry: "2026-10-12T00:00:00Z" }),
        now
      )[0]
    ).toMatchObject({
      fingerprint: "tailscale:key-expiry",
      severity: "medium",
    });
    expect(
      tailscaleFindings(
        with_({ state: "Running", ips: [], keyExpiry: "2026-10-01T00:00:00Z" }),
        now
      )[0]
    ).toMatchObject({ severity: "high", title: "Tailscale key has expired" });
  });
  it("calls a logged-out node down", () => {
    expect(
      tailscaleFindings(with_({ state: "NeedsLogin", ips: [] }), now)[0]
    ).toMatchObject({
      fingerprint: "tailscale:down",
    });
  });
  it("explains what Tailscale SSH and tailnet-only SSH mean for tools that log in with a key", () => {
    const out = tailscaleFindings(
      with_({
        state: "Running",
        ips: ["fd7a::1", "100.64.0.7"],
        ssh: true,
        sshTailnetOnly: true,
      }),
      now
    );
    expect(out.map((f) => f.fingerprint)).toEqual([
      "tailscale:ssh",
      "tailscale:ssh-tailnet-only",
    ]);
    expect(out[0]!.detail).toContain("tailscale set --ssh=false");
    expect(out[0]!.detail).toContain('"action": "accept"');
    expect(out[1]!.detail).toContain("100.64.0.7");
    expect(
      tailscaleFindings(
        with_({ state: "Running", ips: [], ssh: false, sshTailnetOnly: false }),
        now
      )
    ).toEqual([]);
  });
});

describe("osFindings", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const on = (os: string) =>
    report({
      host: {
        hostname: "web-01",
        os,
        cpuCount: 4,
        load: [0.5, 0.5, 0.5],
        memory: { totalBytes: 8e9, availableBytes: 6e9 },
        disks: [{ mount: "/", totalBytes: 100e9, usedBytes: 40e9 }],
      },
    } as Partial<AgentReport>);
  it("flags an Ubuntu out of support, with the way off it", () => {
    const [f] = osFindings(on("Ubuntu 20.04.6 LTS"), now);
    expect(f).toMatchObject({
      severity: "high",
      title: "Ubuntu 20.04 gets no security updates since 2025-05-31",
      reference: "https://moatline.dev/guide/os-upgrade",
    });
    expect(f!.detail).toContain("do-release-upgrade");
    expect(f!.detail).toContain("primary IP");
  });
  it("leaves supported systems alone", () => {
    expect(osFindings(on("Ubuntu 24.04.1 LTS"), now)).toEqual([]);
    expect(osFindings(on("Rocky Linux 9"), now)).toEqual([]);
  });
});
