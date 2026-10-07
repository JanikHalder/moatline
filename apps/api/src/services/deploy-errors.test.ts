import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  deployRuns: {},
  logErrorCounts: {},
  logErrors: {},
  repositories: {},
}));
vi.mock("../lib/notify", () => ({ notify: vi.fn() }));

import { judgeSpike } from "./deploy-errors";

describe("judgeSpike", () => {
  it("calls a burst of new kinds of errors a spike", () => {
    expect(
      judgeSpike({ after: 40, afterMinutes: 10, before: 2000, fresh: 35 }).spike
    ).toBe(true);
  });

  it("calls five times the usual rate a spike", () => {
    // usual: 240 a day = 10 an hour; after: 60 in 10 min = 360 an hour
    expect(
      judgeSpike({ after: 60, afterMinutes: 10, before: 240, fresh: 0 })
    ).toMatchObject({
      spike: true,
    });
  });

  it("leaves a noisy app at its usual noise alone", () => {
    // usual: 2400 a day = 100 an hour; after: 20 in 10 min = 120 an hour
    expect(
      judgeSpike({ after: 20, afterMinutes: 10, before: 2400, fresh: 0 }).spike
    ).toBe(false);
    expect(
      judgeSpike({ after: 150, afterMinutes: 30, before: 2400, fresh: 5 }).spike
    ).toBe(false);
  });

  it("never fires on a handful of errors, even in a quiet app", () => {
    expect(
      judgeSpike({ after: 12, afterMinutes: 5, before: 0, fresh: 12 }).spike
    ).toBe(false);
  });
});
