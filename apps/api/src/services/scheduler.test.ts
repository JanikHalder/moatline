import { describe, it, expect, vi } from "vitest";

// Avoid loading the real db client / scan chain – isDue is pure.
vi.mock("db", () => ({ db: {}, repositories: {}, scans: {} }));
vi.mock("./scan", () => ({ runScan: vi.fn(), SCAN_HEARTBEAT_MS: 60_000 }));

import { isDue, isValidSchedule, nextRunAt } from "./scheduler";

describe("isDue", () => {
  it("is due when never scanned", () => {
    expect(isDue("* * * * *", null)).toBe(true);
  });

  it("is not due right after a scan (every-minute schedule)", () => {
    expect(isDue("* * * * *", new Date())).toBe(false);
  });

  it("is due when the last scan predates the last scheduled slot", () => {
    // Daily at 03:00; last scanned back in 2000 → a slot has passed since.
    expect(isDue("0 3 * * *", new Date("2000-01-01T00:00:00Z"))).toBe(true);
  });

  it("is not due when scanned after the last scheduled slot", () => {
    // Daily at 03:00; scanned "now" (after today's/yesterday's 03:00 slot).
    expect(isDue("0 3 * * *", new Date())).toBe(false);
  });

  it("returns false for an invalid cron expression", () => {
    expect(isDue("not a cron", null)).toBe(false);
  });
});

describe("nextRunAt", () => {
  it("returns the next slot after the last run", () => {
    const last = new Date("2026-01-01T10:05:00Z");
    const next = nextRunAt("0 * * * *", last);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(last.getTime());
    expect(next!.getMinutes()).toBe(0);
  });

  it("is already overdue when the repo was never scanned", () => {
    const next = nextRunAt("0 3 * * *", null);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeLessThan(Date.now());
  });

  it("returns null for an invalid pattern", () => {
    expect(nextRunAt("not a cron", null)).toBeNull();
  });
});

describe("isValidSchedule", () => {
  it("accepts a cron pattern and rejects junk", () => {
    expect(isValidSchedule("0 3 * * *")).toBe(true);
    expect(isValidSchedule("every tuesday")).toBe(false);
  });
});
