import { describe, it, expect } from "vitest";
import { parseNpmAudit, parseV1Advisories, parseV1Output } from "./audit";

describe("parseNpmAudit", () => {
  it("parses a direct vuln with an object advisory and a semver-major fix", () => {
    const report = {
      auditReportVersion: 2,
      vulnerabilities: {
        minimist: {
          name: "minimist",
          severity: "critical",
          isDirect: true,
          via: [
            {
              source: 1179,
              name: "minimist",
              dependency: "minimist",
              title: "Prototype Pollution in minimist",
              url: "https://github.com/advisories/GHSA-xvch-5gv4-984h",
              severity: "critical",
              cwe: ["CWE-1321"],
              cvss: { score: 9.8, vectorString: "CVSS:3.1/..." },
              range: "<1.2.6",
            },
          ],
          range: "<1.2.6",
          fixAvailable: {
            name: "minimist",
            version: "1.2.8",
            isSemVerMajor: true,
          },
        },
      },
    };
    const [v] = parseNpmAudit(report);
    expect(v.packageName).toBe("minimist");
    expect(v.severity).toBe("critical");
    expect(v.ghsaId).toBe("GHSA-xvch-5gv4-984h");
    expect(v.title).toBe("Prototype Pollution in minimist");
    expect(v.vulnerableRange).toBe("<1.2.6");
    expect(v.fixAvailable).toBe(true);
    expect(v.patchedVersion).toBe("1.2.8");
    expect(v.fixIsSemverMajor).toBe(true);
    expect(v.isDirect).toBe(true);
    expect(v.cvssScore).toBe("9.8");
  });

  it("handles fixAvailable=false and string-only via edges", () => {
    const report = {
      vulnerabilities: {
        "some-transitive": {
          severity: "high",
          isDirect: false,
          via: ["another-package"],
          range: ">=1.0.0 <2.0.0",
          fixAvailable: false,
        },
      },
    };
    const [v] = parseNpmAudit(report);
    expect(v.fixAvailable).toBe(false);
    expect(v.patchedVersion).toBeNull();
    expect(v.fixIsSemverMajor).toBe(false);
    expect(v.isDirect).toBe(false);
    expect(v.ghsaId).toBeNull();
    expect(v.vulnerableRange).toBe(">=1.0.0 <2.0.0");
  });

  it("treats fixAvailable=true (boolean) as available without a version", () => {
    const report = {
      vulnerabilities: {
        lodash: { severity: "moderate", via: [], fixAvailable: true },
      },
    };
    const [v] = parseNpmAudit(report);
    expect(v.fixAvailable).toBe(true);
    expect(v.patchedVersion).toBeNull();
    expect(v.severity).toBe("moderate");
  });

  it("returns an empty array for a clean report", () => {
    expect(parseNpmAudit({ vulnerabilities: {} })).toEqual([]);
    expect(parseNpmAudit({})).toEqual([]);
  });

  it("extracts a CVE id from the advisory title when present", () => {
    const report = {
      vulnerabilities: {
        pkg: {
          severity: "low",
          via: [
            {
              title: "Denial of Service (CVE-2021-23337)",
              url: "https://github.com/advisories/GHSA-1234-5678-9abc",
            },
          ],
          fixAvailable: true,
        },
      },
    };
    const [v] = parseNpmAudit(report);
    expect(v.cveId).toBe("CVE-2021-23337");
    expect(v.ghsaId).toBe("GHSA-1234-5678-9abc");
  });
});

const advisory = {
  module_name: "lodash",
  severity: "high",
  title: "Prototype Pollution in lodash",
  url: "https://github.com/advisories/GHSA-p6mc-m468-83gg",
  github_advisory_id: "GHSA-p6mc-m468-83gg",
  cves: ["CVE-2020-8203"],
  vulnerable_versions: "<4.17.20",
  patched_versions: ">=4.17.20",
  cvss: { score: 7.4 },
};

describe("parseV1Advisories (pnpm / yarn)", () => {
  it("normalizes an advisory into the same shape npm produces", () => {
    const rows = parseV1Advisories({ advisories: { "1523": advisory } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      packageName: "lodash",
      severity: "high",
      ghsaId: "GHSA-p6mc-m468-83gg",
      cveId: "CVE-2020-8203",
      vulnerableRange: "<4.17.20",
      patchedVersion: ">=4.17.20",
      fixAvailable: true,
      cvssScore: "7.4",
    });
  });

  it("reads '<0.0.0' as no fix available", () => {
    const rows = parseV1Advisories({
      advisories: { "1": { ...advisory, patched_versions: "<0.0.0" } },
    });
    expect(rows[0]!.fixAvailable).toBe(false);
    expect(rows[0]!.patchedVersion).toBeNull();
  });

  it("marks a package as direct only when the project asked for it", () => {
    const [transitive] = parseV1Advisories({ advisories: { "1": advisory } });
    expect(transitive!.isDirect).toBe(false);
    const [direct] = parseV1Advisories(
      { advisories: { "1": advisory } },
      new Set(["lodash"])
    );
    expect(direct!.isDirect).toBe(true);
  });

  it("never claims a v1 fix is a minor bump", () => {
    // v1 does not say; assuming "not major" would let the breaking-fix gate
    // wave a major through.
    const rows = parseV1Advisories({ advisories: { "1": advisory } });
    expect(rows[0]!.fixIsSemverMajor).toBe(false);
    expect(rows[0]!.fixAvailable).toBe(true);
  });

  it("falls back to the GHSA id in the URL", () => {
    const rows = parseV1Advisories({
      advisories: { "1": { ...advisory, github_advisory_id: undefined } },
    });
    expect(rows[0]!.ghsaId).toBe("GHSA-p6mc-m468-83gg");
  });
});

describe("parseV1Output", () => {
  it("reads a single JSON document (pnpm, yarn berry)", () => {
    const out = parseV1Output(
      JSON.stringify({ advisories: { "1": advisory } })
    );
    expect(out).toHaveLength(1);
    expect(out![0]!.packageName).toBe("lodash");
  });

  it("reads yarn classic's line-delimited stream", () => {
    const stdout = [
      JSON.stringify({ type: "info", data: "..." }),
      JSON.stringify({
        type: "auditAdvisory",
        data: { advisory: { ...advisory, id: 1523 } },
      }),
      JSON.stringify({ type: "auditSummary", data: {} }),
    ].join("\n");
    const out = parseV1Output(stdout);
    expect(out).toHaveLength(1);
    expect(out![0]!.ghsaId).toBe("GHSA-p6mc-m468-83gg");
  });

  it("returns null for output it does not recognize, rather than an empty report", () => {
    // The difference matters: [] would read as "audited, nothing found".
    expect(parseV1Output("command not found")).toBeNull();
    expect(parseV1Output(JSON.stringify({ metadata: {} }))).toBeNull();
  });

  it("reports no findings for a clean audit", () => {
    expect(parseV1Output(JSON.stringify({ advisories: {} }))).toEqual([]);
  });
});
