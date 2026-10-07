import { describe, it, expect, vi } from "vitest";

// security-fix pulls in db + github + dokploy; stub them so we can unit-test
// its pure helpers without a real db client.
vi.mock("db", () => ({ db: {}, updateRuns: {}, repositories: {} }));

import {
  changedBasenames,
  hasRealScript,
  verifyFix,
  summarizeFix,
} from "./security-fix";
import type { Vulnerability } from "../lib/audit";

describe("changedBasenames", () => {
  it("parses git status --porcelain into basenames", () => {
    const porcelain = [
      " M package.json",
      " M package-lock.json",
      "?? apps/web/package.json",
    ].join("\n");
    expect(changedBasenames(porcelain).sort()).toEqual([
      "package-lock.json",
      "package.json",
      "package.json",
    ]);
  });

  it("handles renames (keeps the new path's basename)", () => {
    expect(changedBasenames("R  old/a.js -> new/b.js")).toEqual(["b.js"]);
  });

  it("returns an empty array for empty input", () => {
    expect(changedBasenames("")).toEqual([]);
  });
});

describe("hasRealScript", () => {
  it("is true for a real script", () => {
    expect(hasRealScript({ build: "tsc" }, "build")).toBe(true);
  });
  it("is false when the script is missing", () => {
    expect(hasRealScript({}, "test")).toBe(false);
    expect(hasRealScript(undefined, "build")).toBe(false);
  });
  it("treats the npm default test stub as no test", () => {
    expect(
      hasRealScript(
        { test: 'echo "Error: no test specified" && exit 1' },
        "test"
      )
    ).toBe(false);
  });
  it("accepts a real test script", () => {
    expect(hasRealScript({ test: "vitest run" }, "test")).toBe(true);
  });
});

const vuln = (over: Partial<Vulnerability>): Vulnerability => ({
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

describe("verifyFix", () => {
  it("names what the fix actually removed", () => {
    const gone = vuln({ ghsaId: "GHSA-aaaa" });
    const stays = vuln({ ghsaId: "GHSA-bbbb" });
    const v = verifyFix([gone, stays], [stays]);
    expect(v.resolved.map((x) => x.ghsaId)).toEqual(["GHSA-aaaa"]);
    expect(v.remaining.map((x) => x.ghsaId)).toEqual(["GHSA-bbbb"]);
    expect(v.introduced).toEqual([]);
  });

  it("catches a fix that brings a new advisory with it", () => {
    const before = vuln({ ghsaId: "GHSA-aaaa" });
    const after = vuln({ ghsaId: "GHSA-cccc", packageName: "semver" });
    const v = verifyFix([before], [after]);
    expect(v.resolved).toHaveLength(1);
    expect(v.introduced.map((x) => x.ghsaId)).toEqual(["GHSA-cccc"]);
  });

  it("reports nothing resolved when the audit is unchanged", () => {
    const same = vuln({ ghsaId: "GHSA-aaaa" });
    const v = verifyFix([same], [same]);
    expect(v.resolved).toEqual([]);
    expect(v.remaining).toHaveLength(1);
  });

  it("falls back to package and range when there is no GHSA id", () => {
    const before = vuln({ packageName: "axios", vulnerableRange: "<1.6.0" });
    const after = vuln({ packageName: "axios", vulnerableRange: "<1.6.0" });
    expect(verifyFix([before], [after]).resolved).toEqual([]);
    expect(
      verifyFix(
        [before],
        [vuln({ packageName: "axios", vulnerableRange: "<9" })]
      ).resolved
    ).toHaveLength(1);
  });
});

describe("summarizeFix", () => {
  it("leads with the counts and names what was fixed", () => {
    const summary = summarizeFix(
      verifyFix(
        [vuln({ ghsaId: "GHSA-aaaa" }), vuln({ ghsaId: "GHSA-bbbb" })],
        [vuln({ ghsaId: "GHSA-bbbb" })]
      )
    );
    expect(summary).toBe("1 resolved, 1 remaining — fixed: GHSA-aaaa");
  });

  it("calls out advisories the fix introduced", () => {
    const summary = summarizeFix(
      verifyFix([vuln({ ghsaId: "GHSA-aaaa" })], [vuln({ ghsaId: "GHSA-new" })])
    );
    expect(summary).toMatch(/1 introduced/);
  });
});
