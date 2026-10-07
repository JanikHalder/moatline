import { describe, expect, it } from "vitest";
import { verdictOf } from "./repo-verdict";

const base = {
  repo: {
    liveUrl: "https://example.com",
    liveStatus: "up" as const,
    liveCheckedAt: null,
  },
  lastScan: { status: "success", auditNote: null, finishedAt: null },
  vulns: [] as Array<{
    severity: "critical" | "high" | "moderate" | "low";
    fixAvailable: boolean;
  }>,
  onFix: () => {},
  onScan: () => {},
  fixing: false,
  scanning: false,
  fixRunning: false,
};

describe("verdictOf", () => {
  it("puts a site that is down above everything else", () => {
    const v = verdictOf({
      ...base,
      repo: { ...base.repo, liveStatus: "down" },
      vulns: [{ severity: "critical", fixAvailable: true }],
    });
    expect(v.tone).toBe("bad");
    expect(v.title).toBe("The site is not reachable right now");
  });

  it("offers the automatic fix when updates fix the serious holes", () => {
    const v = verdictOf({
      ...base,
      vulns: [
        { severity: "critical", fixAvailable: true },
        { severity: "high", fixAvailable: true },
        { severity: "low", fixAvailable: false },
      ],
    });
    expect(v.title).toBe("2 serious security holes");
    expect(v.action).not.toBeNull();
  });

  it("does not offer a second fix while one is on its way", () => {
    const v = verdictOf({
      ...base,
      fixRunning: true,
      vulns: [{ severity: "high", fixAvailable: true }],
    });
    expect(v.action).toBeNull();
    expect(v.detail).toContain("on its way");
  });

  it("never calls a failed or incomplete check good", () => {
    expect(
      verdictOf({ ...base, lastScan: { ...base.lastScan, status: "failed" } })
        .tone
    ).toBe("warn");
    expect(
      verdictOf({
        ...base,
        lastScan: { ...base.lastScan, auditNote: "npm audit failed" },
      }).tone
    ).toBe("warn");
  });

  it("says all good when only minor holes remain", () => {
    const v = verdictOf({
      ...base,
      vulns: [{ severity: "low", fixAvailable: false }],
    });
    expect(v.tone).toBe("good");
    expect(v.detail).toContain("nothing urgent");
  });
});
