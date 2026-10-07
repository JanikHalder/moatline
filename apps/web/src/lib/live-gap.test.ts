import { describe, it, expect } from "vitest";
import { compareVulnerabilities } from "./live-gap";
import type { Vulnerability } from "./api";

const vuln = (over: Partial<Vulnerability>): Vulnerability => ({
  id: Math.random().toString(36).slice(2),
  scanId: "s1",
  packageName: "lodash",
  severity: "high",
  ghsaId: null,
  cveId: null,
  title: null,
  url: null,
  vulnerableRange: null,
  patchedVersion: null,
  fixAvailable: true,
  fixIsSemverMajor: false,
  isDirect: true,
  cvssScore: null,
  ...over,
});

describe("compareVulnerabilities", () => {
  it("separates the fix that was never deployed from the one with no fix", () => {
    const shipped = vuln({ ghsaId: "GHSA-aaaa" });
    const open = vuln({ ghsaId: "GHSA-bbbb" });
    const fresh = vuln({ ghsaId: "GHSA-cccc" });

    const gap = compareVulnerabilities(
      [shipped, open], // deployed commit
      [open, fresh] // branch
    );

    expect(gap.fixedNotDeployed.map((v) => v.ghsaId)).toEqual(["GHSA-aaaa"]);
    expect(gap.stillOpen.map((v) => v.ghsaId)).toEqual(["GHSA-bbbb"]);
    expect(gap.newSinceDeploy.map((v) => v.ghsaId)).toEqual(["GHSA-cccc"]);
  });

  it("matches on package and CVE when no GHSA id is recorded", () => {
    const live = vuln({ packageName: "axios", cveId: "CVE-2024-1" });
    const branch = vuln({
      packageName: "axios",
      cveId: "CVE-2024-1",
      severity: "critical", // severity may be re-rated; identity holds
    });

    const gap = compareVulnerabilities([live], [branch]);
    expect(gap.fixedNotDeployed).toEqual([]);
    expect(gap.stillOpen).toHaveLength(1);
  });

  it("keeps advisories for different packages apart", () => {
    const gap = compareVulnerabilities(
      [vuln({ packageName: "axios", title: "prototype pollution" })],
      [vuln({ packageName: "lodash", title: "prototype pollution" })]
    );
    expect(gap.fixedNotDeployed).toHaveLength(1);
    expect(gap.newSinceDeploy).toHaveLength(1);
    expect(gap.stillOpen).toEqual([]);
  });

  it("reports nothing when both sides are clean", () => {
    expect(compareVulnerabilities([], [])).toEqual({
      fixedNotDeployed: [],
      stillOpen: [],
      newSinceDeploy: [],
    });
  });
});
