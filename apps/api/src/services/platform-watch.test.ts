import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, orgIntegrations: {} }));
vi.mock("./deploy", () => ({ resolveDokployConfig: vi.fn() }));

import { affecting, inRange, type Advisory } from "./platform-watch";

const adv = (id: string, ranges: string[]): Advisory => ({
  id,
  cve: null,
  summary: id,
  severity: "critical",
  url: `https://github.com/advisories/${id}`,
  ranges,
  patched: null,
});

describe("platform watch", () => {
  it("reads GitHub's version ranges, betas included", () => {
    expect(inRange("4.0.0-beta.359", "<= 4.0.0-beta.359")).toBe(true);
    expect(inRange("4.0.0-beta.420", "< 4.0.0-beta.400")).toBe(false);
    expect(inRange("4.0.0-beta.99", "< 4.0.0-beta.400")).toBe(true);
    expect(inRange("0.22.4", ">= 0.20.0, < 0.22.5")).toBe(true);
    expect(inRange("v0.22.5", ">= 0.20.0, < 0.22.5")).toBe(false);
    expect(inRange("not a version", "< 1")).toBeNull();
  });

  it("keeps only the advisories the installed version is affected by", () => {
    const list = [
      adv("GHSA-old", ["< 0.10.0"]),
      adv("GHSA-now", [">= 0.20.0, < 0.25.0"]),
      adv("GHSA-odd", ["latest"]),
    ];
    expect(affecting("0.24.1", list).map((a) => a.id)).toEqual(["GHSA-now"]);
    expect(affecting("0.26.0", list)).toEqual([]);
  });
});
