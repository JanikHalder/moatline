import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, probeResults: {}, repositories: {} }));

import { configuredProbes, confirm, FRESH_MS, probeOfToken } from "./probes";

const T = "a-long-probe-token-1234";

describe("probes", () => {
  it("reads PROBE_TOKENS and drops what is not a name and a long token", () => {
    expect(
      configuredProbes({
        PROBE_TOKENS: `falkenstein:${T}, ashburn:${T}x ,bad, short:123, :${T}`,
      } as NodeJS.ProcessEnv).map((p) => p.name)
    ).toEqual(["falkenstein", "ashburn"]);
  });

  it("knows a probe by its token", () => {
    const probes = [{ name: "fsn", token: T }];
    expect(probeOfToken(T, probes)).toBe("fsn");
    expect(probeOfToken(`${T}x`, probes)).toBeNull();
    expect(probeOfToken(null, probes)).toBeNull();
  });

  it("confirms an outage when another location sees it too", () => {
    const now = Date.now();
    const at = new Date(now - 30_000);
    expect(
      confirm(
        [
          { probe: "fsn", ok: false, checkedAt: at },
          { probe: "ash", ok: true, checkedAt: at },
        ],
        ["fsn", "ash"],
        now
      )
    ).toEqual({ state: "down", down: ["fsn"], up: ["ash"] });
    expect(
      confirm([{ probe: "fsn", ok: true, checkedAt: at }], ["fsn"], now).state
    ).toBe("up");
  });

  it("waits for fresh answers and ignores stale or unknown probes", () => {
    const now = Date.now();
    const old = new Date(now - FRESH_MS - 1000);
    expect(
      confirm(
        [
          { probe: "fsn", ok: false, checkedAt: old },
          { probe: "gone", ok: false, checkedAt: new Date(now) },
        ],
        ["fsn"],
        now
      ).state
    ).toBe("pending");
    expect(confirm([], [], now).state).toBe("none");
  });
});
