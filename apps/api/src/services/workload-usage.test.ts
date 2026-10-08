import { describe, it, expect, vi } from "vitest";

vi.mock("db", () => ({ db: {}, containerMetrics: {}, servers: {} }));

import { aggregateApps, usageFindings } from "./workload-usage";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const c = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  image: "ghcr.io/x/shop:1",
  app: "shop",
  memBytes: 300 * MB,
  memLimit: null,
  cpuPct: 2,
  oomKilled: false,
  ...extra,
});
const baseline = (mem: number, cpu = 3, samples = 2000) => ({
  computedAt: new Date().toISOString(),
  apps: { shop: { mem, cpu, samples, since: "" } },
});

describe("aggregateApps", () => {
  it("adds replicas up and keeps a limit only when all have one", () => {
    const [a] = aggregateApps([
      c("shop.1.a", { memLimit: GB }),
      c("shop.2.b", { memLimit: null }),
    ]);
    expect(a).toMatchObject({ memBytes: 600 * MB, memLimit: null, cpuPct: 4 });
  });
});

describe("usageFindings", () => {
  it("is quiet at the usual level", () => {
    expect(
      usageFindings([c("shop-1")], {
        baseline: baseline(280 * MB),
        hostMemBytes: 8 * GB,
      })
    ).toEqual([]);
  });

  it("raises an app far above its own median", () => {
    const [f] = usageFindings([c("shop-1", { memBytes: 1.2 * GB })], {
      baseline: baseline(300 * MB),
    });
    expect(f).toMatchObject({
      fingerprint: "usage:memory:shop",
      severity: "high",
      title: "shop uses 4.1× its usual memory",
    });
    expect(f!.detail).toContain("max-old-space-size");
    expect(f!.detail).toContain("heap snapshot");
  });

  it("waits for a day of history before calling anything unusual", () => {
    expect(
      usageFindings([c("shop-1", { memBytes: 1.2 * GB })], {
        baseline: baseline(300 * MB, 3, 50),
      })
    ).toEqual([]);
  });

  it("warns near the limit and after an OOM kill", () => {
    const f = usageFindings([
      c("shop-1", { memBytes: 950 * MB, memLimit: GB, oomKilled: true }),
    ]);
    expect(f.map((x) => [x.fingerprint, x.severity])).toEqual([
      ["usage:oom:shop", "high"],
      ["usage:limit:shop", "high"],
    ]);
  });

  it("flags a big share of the host without a limit", () => {
    const [f] = usageFindings([c("shop-1", { memBytes: 3.5 * GB })], {
      hostMemBytes: 8 * GB,
    });
    expect(f).toMatchObject({
      fingerprint: "usage:share:shop",
      severity: "medium",
    });
  });

  it("flags a core busy for two reports, not one", () => {
    const hot = [c("shop-1", { cpuPct: 99 })];
    expect(usageFindings(hot, { previous: [c("shop-1")] })).toEqual([]);
    expect(usageFindings(hot, { previous: hot })[0]).toMatchObject({
      fingerprint: "usage:cpu:shop",
      severity: "medium",
    });
  });
});
