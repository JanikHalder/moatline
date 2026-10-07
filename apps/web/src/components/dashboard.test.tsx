import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard } from "./dashboard";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("@/lib/api", () => ({
  api: {
    getOpenIncidents: vi.fn().mockResolvedValue([
      {
        id: "i1",
        repositoryId: "r2",
        name: "Landing",
        startedAt: new Date().toISOString(),
        cause: "HTTP 502",
        healAttempts: 1,
      },
    ]),
    getImportantFindings: vi.fn().mockResolvedValue([
      {
        id: "f1",
        serverId: "srv1",
        serverName: "web-1",
        repositoryId: null,
        repositoryName: null,
        source: "host",
        fingerprint: "container:restarting:mongo.1.abcdef123",
        severity: "high",
        title: "Container mongo.1.abcdef123 keeps restarting",
        detail: null,
        target: "mongo:6",
        reference: null,
        fixAvailable: null,
        autoFixAt: null,
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-01T00:00:00Z",
        resolvedAt: null,
      },
      {
        id: "f2",
        serverId: "srv1",
        serverName: "web-1",
        repositoryId: null,
        repositoryName: null,
        source: "host",
        fingerprint: "updates:security",
        severity: "medium",
        title: "7 security updates pending",
        detail: null,
        target: "apt",
        reference: null,
        fixAvailable: null,
        // installed tonight by unattended-upgrades: not a task
        autoFixAt: "2099-01-01T03:00:00Z",
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-01T00:00:00Z",
        resolvedAt: null,
      },
    ]),
    getDashboard: vi.fn().mockResolvedValue({
      totals: { critical: 2, high: 1, moderate: 0, low: 0, info: 0, total: 3 },
      branchTotals: {
        critical: 0,
        high: 1,
        moderate: 0,
        low: 0,
        info: 0,
        total: 1,
      },
      liveCoverage: { live: 1, total: 1 },
      fixedNotDeployed: 2,
      servers: {
        total: 0,
        reporting: 0,
        stale: 0,
        never: 0,
        findings: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
          total: 0,
        },
      },
      repos: [
        {
          repositoryId: "r1",
          name: "My Repo",
          githubUrl: "https://github.com/o/r",
          autoFixCritical: true,
          autoDeploy: false,
          lastScanAt: "2026-01-01T00:00:00Z",
          lastScanId: "s1",
          scanned: true,
          counts: {
            critical: 2,
            high: 1,
            moderate: 0,
            low: 0,
            info: 0,
            total: 3,
          },
          exposureSource: "live",
          branchCounts: {
            critical: 0,
            high: 1,
            moderate: 0,
            low: 0,
            info: 0,
            total: 1,
          },
          liveCounts: {
            critical: 2,
            high: 1,
            moderate: 0,
            low: 0,
            info: 0,
            total: 3,
          },
          liveScanAt: "2026-01-01T00:00:00Z",
          liveCommit: "752de05e244d374ce98fa7a841c9280b1fa19be3",
          liveUrl: "https://app.example.com/api/health",
          liveStatus: "up",
          fixedNotDeployed: 2,
          appFindings: { total: 1, high: 1 },
          serverId: "srv1",
        },
      ],
    }),
  },
}));

describe("Dashboard", () => {
  it("lists what needs someone, most urgent first, in plain words", async () => {
    render(<Dashboard />);
    await screen.findByText("What needs you");
    const titles = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("p")?.textContent);
    expect(titles).toEqual([
      "Landing is not reachable",
      "My Repo has 2 critical security holes",
      "mongo keeps crashing and restarting",
      "A fix for My Repo is ready, but not live yet",
    ]);
    // What the server installs tonight by itself is no task.
    expect(screen.queryByText(/security updates waiting/)).toBeNull();
  });

  it("keeps the sites table with exposure on the deployed version", async () => {
    render(<Dashboard />);
    await screen.findByText("My Repo");
    // The deployed commit is what the numbers describe.
    expect(screen.getByText("752de05")).toBeInTheDocument();
    expect(screen.getByText("2 fixed, not deployed")).toBeInTheDocument();
    expect(screen.getByText("2 critical")).toBeInTheDocument();
    // Nuclei/Kuma findings on the running application.
    expect(screen.getAllByText(/1 high/).length).toBeGreaterThan(0);
  });
});
