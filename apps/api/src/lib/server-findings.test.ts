import { describe, it, expect, vi } from "vitest";

vi.mock("db", () => ({ db: {}, serverFindings: {}, servers: {} }));

import {
  findingEvent,
  normalizeSeverity,
  safeReference,
} from "./server-findings";

describe("safeReference", () => {
  it("keeps http(s) links and drops everything that could run script", () => {
    expect(safeReference("https://nvd.nist.gov/vuln/detail/CVE-1")).toBe(
      "https://nvd.nist.gov/vuln/detail/CVE-1"
    );
    expect(safeReference("javascript:alert(1)")).toBeNull();
    expect(safeReference("data:text/html,<script>")).toBeNull();
    expect(safeReference("not a url")).toBeNull();
  });
});

describe("normalizeSeverity", () => {
  it("maps every scanner's vocabulary onto one scale", () => {
    expect(normalizeSeverity("CRITICAL")).toBe("critical");
    expect(normalizeSeverity("moderate")).toBe("medium");
    expect(normalizeSeverity("UNKNOWN")).toBe("info");
  });
});

describe("findingEvent", () => {
  it("maps a new finding to a server.finding.opened event", () => {
    const e = findingEvent({ id: "srv-1", name: "example-server-1" }, "host", {
      fingerprint: "usage:oom:shop",
      severity: "high",
      title: "shop was killed for running out of memory",
      target: "ghcr.io/x/shop:1",
    });
    expect(e).toMatchObject({
      name: "server.finding.opened",
      title: "example-server-1: shop was killed for running out of memory",
      severity: "error",
      attributes: {
        serverId: "srv-1",
        source: "host",
        fingerprint: "usage:oom:shop",
        findingSeverity: "high",
        target: "ghcr.io/x/shop:1",
      },
    });
  });

  it("maps medium to warn and low to info", () => {
    const base = { id: "s", name: "n" };
    expect(
      findingEvent(base, "host", {
        fingerprint: "a",
        severity: "medium",
        title: "t",
      }).severity
    ).toBe("warn");
    expect(
      findingEvent(base, "host", {
        fingerprint: "a",
        severity: "low",
        title: "t",
      }).severity
    ).toBe("info");
  });

  it("cuts long details", () => {
    const e = findingEvent({ id: "s", name: "n" }, "host", {
      fingerprint: "a",
      severity: "low",
      title: "t",
      detail: "x".repeat(900),
    });
    expect((e.attributes?.detail as string).length).toBe(500);
  });
});
