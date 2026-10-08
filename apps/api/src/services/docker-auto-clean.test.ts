import { describe, it, expect } from "vitest";
import { shouldAutoCleanDocker } from "./docker-auto-clean";

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
});
