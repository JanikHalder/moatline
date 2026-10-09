import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  deployRuns: {},
  packageFindings: {},
  repositories: {},
  scans: {},
  serverFindings: {},
  vulnerabilities: {},
}));

import { renderFindings, type FindingsData } from "./findings-report";

const data: FindingsData = {
  repo: {
    name: "shop",
    githubUrl: "https://github.com/acme/shop",
    defaultBranch: "main",
    packageJsonPath: "package.json",
    liveUrl: "https://shop.example/api/health",
    liveCommit: "752de05",
    liveChecks: { email: false, storage: true },
    siteProbe: null,
    deployCheck: {
      checkedAt: "2026-10-03T08:00:00Z",
      next: {
        usesNext: true,
        configStandalone: false,
        startUsesStandalone: false,
        dockerfileStandalone: false,
        missing: true,
        startMismatch: false,
      },
      findings: [
        {
          id: "next:standalone",
          severity: "high",
          title: "Next.js is not built as standalone",
          detail: "Without standalone Dokploy images stay large.",
          howto: "next-standalone.md",
        },
      ],
    },
    configCheck: {
      checkedAt: "2026-10-03T08:00:00Z",
      items: [
        {
          label: "Server Actions key",
          names: ["NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"],
          required: true,
          ok: false,
          why: "Without a stable key every deploy breaks open tabs.",
        },
      ],
    },
  },
  scan: {
    startedAt: new Date("2026-10-03T09:00:00Z"),
    ref: "main",
    target: "default",
  },
  vulns: [
    {
      id: "v1",
      scanId: "s1",
      packageName: "next",
      severity: "high",
      ghsaId: "GHSA-8h8q-6873-q5fj",
      cveId: null,
      title: "Next.js DoS with Server Components",
      url: "https://github.com/advisories/GHSA-8h8q-6873-q5fj",
      vulnerableRange: ">=13.0.0 <15.5.16",
      patchedVersion: "15.5.16",
      fixAvailable: true,
      fixIsSemverMajor: false,
      isDirect: true,
      cvssScore: "7.5",
    },
  ],
  packages: [
    {
      id: "p1",
      scanId: "s1",
      packageName: "zod",
      currentVersion: "3.22.0",
      latestVersion: "4.1.0",
      wantedVersion: "^3.22.0",
      isDevDependency: false,
      unused: false,
    },
  ],
  live: [],
  lastDeploy: null,
  generatedAt: new Date("2026-10-03T10:00:00Z"),
};

describe("renderFindings", () => {
  it("turns a scan into tasks a coding agent can work through", () => {
    const md = renderFindings(data);
    expect(md).toContain("# Findings: shop");
    expect(md).toContain(
      "- [ ] **high** `next` >=13.0.0 <15.5.16 → fixed in `15.5.16`: raise `next` in package.json to `^15.5.16`"
    );
    expect(md).toContain("`zod` ^3.22.0 → 4.1.0");
    expect(md).toContain("`email: false`");
    expect(md).toContain(
      "Set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` in the Dokploy application"
    );
    expect(md).toContain("Next.js is not built as standalone");
    expect(md).toContain(
      "# Fix: Next.js standalone for smaller Dokploy images"
    );
    expect(md).not.toMatch(/secret value|password/i);
  });
});
