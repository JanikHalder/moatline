import { describe, it, expect, vi } from "vitest";

vi.mock("db", () => ({ db: {} }));
vi.mock("./server-scheduler", () => ({ STALE_AFTER_MS: 20 * 60 * 1000 }));

import { formatDigest, sendDueDigests, type DigestData } from "./digest";

const data = (over: Partial<DigestData> = {}): DigestData => ({
  orgName: "Acme Agency",
  servers: { total: 3, silent: ["ionos-server"] },
  open: { critical: 1, high: 2, medium: 0, low: 4 },
  newThisWeek: 5,
  resolvedThisWeek: 7,
  top: [
    {
      severity: "critical",
      title: "Service shop is down (0/1)",
      server: "md-3",
    },
  ],
  appsWithCriticalCves: [{ name: "shop", critical: 1, high: 0 }],
  monitorsDown: ["Shop"],
  certsExpiring: [{ name: "Blog", days: 5 }],
  ...over,
});

describe("formatDigest", () => {
  it("summarizes what is open, what changed and what is silent", () => {
    const { title, message } = formatDigest(data());
    expect(title).toBe("Weekly security summary — Acme Agency");
    expect(message).toContain("Open: 1 critical · 2 high · 0 medium · 4 low");
    expect(message).toContain("This week: 5 new · 7 resolved");
    expect(message).toContain("Servers: 2/3 reporting — silent: ionos-server");
    expect(message).toContain("[CRITICAL] Service shop is down (0/1) — md-3");
    expect(message).toContain("shop: 1 critical, 0 high");
    expect(message).toContain("Down right now: Shop");
    expect(message).toContain("Blog (5d)");
  });

  it("says so when everything is quiet", () => {
    const { message } = formatDigest(
      data({
        servers: { total: 1, silent: [] },
        open: { critical: 0, high: 0, medium: 0, low: 0 },
        top: [],
        appsWithCriticalCves: [],
        monitorsDown: [],
        certsExpiring: [],
      })
    );
    expect(message).toContain("Nothing open");
  });
});

describe("sendDueDigests", () => {
  it("does nothing outside Monday morning", async () => {
    // Would throw on the empty db mock if it tried to query.
    await sendDueDigests(new Date("2026-10-01T09:00:00Z")); // Thursday
    await sendDueDigests(new Date("2026-10-05T06:00:00Z")); // Monday, too early
  });
});
