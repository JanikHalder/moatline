import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, cronChecks: {} }));

import { human, newToken, overdueAt } from "./cron-checks";

describe("cron checks", () => {
  it("is overdue after its period plus grace", () => {
    const last = new Date("2026-10-06T03:00:00Z");
    expect(
      overdueAt({ lastPingAt: last, periodSeconds: 86400, graceSeconds: 3600 })
    ).toEqual(new Date("2026-10-07T04:00:00Z"));
    expect(
      overdueAt({ lastPingAt: null, periodSeconds: 60, graceSeconds: 60 })
    ).toBeNull();
  });

  it("names periods and makes unguessable tokens", () => {
    expect(human(86400)).toBe("1 d");
    expect(human(7200)).toBe("2 h");
    expect(human(300)).toBe("5 min");
    expect(newToken()).toMatch(/^[\w-]{24}$/);
    expect(newToken()).not.toBe(newToken());
  });
});
