import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  deployRuns: {},
  incidents: {},
  repositories: {},
}));
vi.mock("../lib/notify", () => ({ notify: vi.fn() }));
vi.mock("./deploy", () => ({ resolveDokployConfig: vi.fn() }));
vi.mock("./log-errors", () => ({ errorSummary: vi.fn() }));

import { decideIncident, uptimeOf } from "./incidents";

const MIN = 60_000;
const now = Date.parse("2026-10-05T12:00:00Z");
const base = {
  ok: false,
  failures: 1,
  open: null,
  autoHeal: true,
  deploying: false,
  healsToday: 0,
  now,
};
const openSince = (min: number, extra = {}) => ({
  startedAt: new Date(now - min * MIN),
  healAttempts: 0,
  healedAt: null,
  escalatedAt: null,
  ...extra,
});

describe("decideIncident", () => {
  it("opens only when another location confirms, and not when one reaches it", () => {
    const at = { ...base, ok: false, failures: 2 };
    expect(decideIncident({ ...at, confirm: "down" })).toBe("open");
    expect(decideIncident({ ...at, confirm: "up" })).toBeNull();
    expect(decideIncident({ ...at, confirm: "pending" })).toBeNull();
    expect(decideIncident({ ...at, failures: 4, confirm: "pending" })).toBe(
      "open"
    );
    expect(decideIncident({ ...at, confirm: "none" })).toBe("open");
  });

  it("opens on the second failure, not the first, and not during a deploy", () => {
    expect(decideIncident(base)).toBeNull();
    expect(decideIncident({ ...base, failures: 2 })).toBe("open");
    expect(
      decideIncident({ ...base, failures: 5, deploying: true })
    ).toBeNull();
  });

  it("restarts after five minutes, once", () => {
    expect(decideIncident({ ...base, open: openSince(3) })).toBeNull();
    expect(decideIncident({ ...base, open: openSince(5) })).toBe("heal");
    expect(
      decideIncident({
        ...base,
        open: openSince(8, {
          healAttempts: 1,
          healedAt: new Date(now - 3 * MIN),
        }),
      })
    ).toBeNull();
  });

  it("escalates when the restart did not help", () => {
    expect(
      decideIncident({
        ...base,
        open: openSince(16, {
          healAttempts: 1,
          healedAt: new Date(now - 11 * MIN),
        }),
      })
    ).toBe("escalate");
  });

  it("stops restarting after three a day and escalates at 30 minutes", () => {
    expect(
      decideIncident({ ...base, healsToday: 3, open: openSince(10) })
    ).toBeNull();
    expect(
      decideIncident({ ...base, healsToday: 3, open: openSince(30) })
    ).toBe("escalate");
    expect(
      decideIncident({ ...base, autoHeal: false, open: openSince(31) })
    ).toBe("escalate");
  });

  it("escalates only once and resolves when the site answers", () => {
    expect(
      decideIncident({
        ...base,
        autoHeal: false,
        open: openSince(60, { escalatedAt: new Date(now - 20 * MIN) }),
      })
    ).toBeNull();
    expect(decideIncident({ ...base, ok: true, open: openSince(9) })).toBe(
      "resolve"
    );
    expect(decideIncident({ ...base, ok: true })).toBeNull();
  });
});

describe("uptimeOf", () => {
  it("counts only the part of each outage inside the period", () => {
    const from = Date.parse("2026-09-01T00:00:00Z");
    const to = Date.parse("2026-10-01T00:00:00Z");
    const u = uptimeOf(
      [
        // 30 minutes inside
        {
          startedAt: new Date("2026-09-10T10:00:00Z"),
          resolvedAt: new Date("2026-09-10T10:30:00Z"),
        },
        // started before the period: only the hour after midnight counts
        {
          startedAt: new Date("2026-08-31T23:00:00Z"),
          resolvedAt: new Date("2026-09-01T01:00:00Z"),
        },
      ],
      from,
      to
    );
    expect(u).toBeCloseTo(1 - 90 / (30 * 24 * 60), 6);
  });
});
