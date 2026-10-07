import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, deployRuns: {}, repositories: {} }));

import { newKills, oomFindings } from "./oom-events";

describe("OOM events", () => {
  it("counts new kills from the kernel's counter, across reboots", () => {
    expect(newKills(3, 5)).toBe(2);
    expect(newKills(5, 5)).toBe(0);
    expect(newKills(40, 1)).toBe(1);
    expect(newKills(null, 5)).toBe(0);
    expect(newKills(5, null)).toBe(0);
  });

  it("blames the deploy when one was running, else the server", () => {
    const at = new Date().toISOString();
    expect(
      oomFindings({
        at,
        count: 1,
        victims: ["next-server"],
        duringDeploy: ["shop"],
      })
    ).toMatchObject([{ fingerprint: "oom:build", severity: "high" }]);
    const plain = oomFindings({ at, count: 2, victims: [], duringDeploy: [] });
    expect(plain).toMatchObject([{ fingerprint: "oom:host" }]);
    expect(plain[0]!.detail).toContain("2×");
  });

  it("lets an old event go after a day", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(
      oomFindings({ at: old, count: 1, victims: [], duringDeploy: [] })
    ).toEqual([]);
  });
});
