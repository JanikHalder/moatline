import { describe, it, expect } from "vitest";
import {
  shouldAutoCleanDocker,
  shouldBlockDeployForDisk,
} from "./docker-auto-clean";

describe("shouldAutoCleanDocker", () => {
  it("runs when disk is over threshold and Docker can free ≥2 GB", () => {
    expect(
      shouldAutoCleanDocker({
        diskPct: 90,
        diskThreshold: 85,
        reclaimableBytes: 5 * 1024 ** 3,
        lastCleanAt: null,
      })
    ).toBe(true);
  });

  it("skips when disk is fine or reclaimable is small", () => {
    expect(
      shouldAutoCleanDocker({
        diskPct: 50,
        diskThreshold: 85,
        reclaimableBytes: 10 * 1024 ** 3,
        lastCleanAt: null,
      })
    ).toBe(false);
    expect(
      shouldAutoCleanDocker({
        diskPct: 95,
        diskThreshold: 85,
        reclaimableBytes: 500 * 1024 ** 2,
        lastCleanAt: null,
      })
    ).toBe(false);
  });

  it("respects the cooldown", () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    expect(
      shouldAutoCleanDocker({
        diskPct: 95,
        diskThreshold: 85,
        reclaimableBytes: 5 * 1024 ** 3,
        lastCleanAt: "2026-10-08T20:00:00Z",
        now,
      })
    ).toBe(false);
    expect(
      shouldAutoCleanDocker({
        diskPct: 95,
        diskThreshold: 85,
        reclaimableBytes: 5 * 1024 ** 3,
        lastCleanAt: "2026-10-08T12:00:00Z",
        now,
      })
    ).toBe(true);
  });

  it("skips cooldown before a deploy", () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    expect(
      shouldAutoCleanDocker({
        diskPct: 95,
        diskThreshold: 85,
        reclaimableBytes: 5 * 1024 ** 3,
        lastCleanAt: "2026-10-08T23:00:00Z",
        now,
        skipCooldown: true,
      })
    ).toBe(true);
  });
});

describe("shouldBlockDeployForDisk", () => {
  const now = Date.parse("2026-10-09T02:30:00Z");
  const fresh = new Date(now - 5 * 60 * 1000);

  it("blocks on a nearly full disk with a fresh reading and nothing cleaned", () => {
    expect(
      shouldBlockDeployForDisk({
        diskPct: 96,
        reportAt: fresh,
        cleaned: false,
        now,
      })
    ).toBe(true);
  });

  it("lets the deploy through below the limit, after a clean, or on stale/missing data", () => {
    const base = { diskPct: 96, reportAt: fresh, cleaned: false, now };
    expect(shouldBlockDeployForDisk({ ...base, diskPct: 90 })).toBe(false);
    expect(shouldBlockDeployForDisk({ ...base, cleaned: true })).toBe(false);
    expect(shouldBlockDeployForDisk({ ...base, diskPct: null })).toBe(false);
    expect(shouldBlockDeployForDisk({ ...base, reportAt: null })).toBe(false);
    expect(
      shouldBlockDeployForDisk({
        ...base,
        reportAt: new Date(now - 2 * 60 * 60 * 1000),
      })
    ).toBe(false);
  });
});
