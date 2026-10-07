import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  incidents: {},
  repositories: {},
  statusPages: {},
  deployRuns: {},
  probeResults: {},
}));

import { dailyDowntime, slugOk } from "./status-pages";

const DAY = 24 * 60 * 60 * 1000;

describe("status pages", () => {
  it("spreads downtime over the days it fell on", () => {
    const now = Date.UTC(2026, 9, 6, 12);
    const days = dailyDowntime(
      [
        // 23:30 → 00:30 across midnight: 30 minutes on each day.
        {
          startedAt: new Date(Date.UTC(2026, 9, 4, 23, 30)),
          resolvedAt: new Date(Date.UTC(2026, 9, 5, 0, 30)),
        },
        // Still open since 11:00 today.
        { startedAt: new Date(Date.UTC(2026, 9, 6, 11)), resolvedAt: null },
      ],
      now,
      3
    );
    expect(days).toEqual([
      { date: "2026-10-04", downMinutes: 30 },
      { date: "2026-10-05", downMinutes: 30 },
      { date: "2026-10-06", downMinutes: 60 },
    ]);
    expect(dailyDowntime([], now).length).toBe(90);
    expect(dailyDowntime([], now)[89]!.date).toBe(
      new Date(now - (now % DAY)).toISOString().slice(0, 10)
    );
  });

  it("takes only clean, unreserved addresses", () => {
    expect(slugOk("acme-shop")).toBe(true);
    expect(slugOk("ab")).toBe(false);
    expect(slugOk("-acme")).toBe(false);
    expect(slugOk("Acme")).toBe(false);
    expect(slugOk("api")).toBe(false);
  });
});
