import { describe, expect, it } from "vitest";
import { shouldSkipOvernightForDisk } from "./security-overnight";

const NOW = Date.parse("2026-10-09T02:15:00Z");
const fresh = new Date(NOW - 10 * 60 * 1000).toISOString();

describe("shouldSkipOvernightForDisk", () => {
  it("skips at or above 80% with a fresh report", () => {
    expect(shouldSkipOvernightForDisk({ diskPct: 80, reportAt: fresh, now: NOW })).toBe(true);
    expect(shouldSkipOvernightForDisk({ diskPct: 87, reportAt: fresh, now: NOW })).toBe(true);
  });

  it("runs below 80%", () => {
    expect(shouldSkipOvernightForDisk({ diskPct: 79, reportAt: fresh, now: NOW })).toBe(false);
  });

  it("runs when the disk reading is unknown or the report is stale", () => {
    expect(shouldSkipOvernightForDisk({ diskPct: null, reportAt: fresh, now: NOW })).toBe(false);
    expect(shouldSkipOvernightForDisk({ diskPct: 95, reportAt: null, now: NOW })).toBe(false);
    const old = new Date(NOW - 7 * 60 * 60 * 1000).toISOString();
    expect(shouldSkipOvernightForDisk({ diskPct: 95, reportAt: old, now: NOW })).toBe(false);
  });
});
