import { describe, it, expect, vi } from "vitest";

vi.mock("db", () => ({ db: {}, servers: {}, serverFindings: {} }));

import {
  networkFindings,
  resolveAddress,
  type NetworkState,
} from "./network-check";

function state(open: number[], expected = [80, 443]): NetworkState {
  const ports = [22, 80, 443, 5432, 6379].map((port) => ({
    port,
    open: open.includes(port),
    latencyMs: open.includes(port) ? 10 : null,
    service: String(port),
    expected: expected.includes(port),
  }));
  return {
    checkedAt: new Date().toISOString(),
    address: "203.0.113.10",
    resolved: ["203.0.113.10"],
    ports,
    tls: null,
    error: null,
  };
}

describe("networkFindings", () => {
  it("is quiet when exactly the expected ports answer", () => {
    expect(networkFindings(state([80, 443]))).toEqual([]);
  });

  it("raises a public database as critical and a missing web port as high", () => {
    const f = networkFindings(state([80, 5432, 6379]));
    expect(f.map((x) => [x.fingerprint, x.severity])).toEqual([
      ["expected:443", "high"],
      ["open:5432", "critical"],
      ["open:6379", "critical"],
    ]);
  });

  it("treats an expected port as fine and reports a dead server once", () => {
    expect(networkFindings(state([22, 80, 443], [22, 80, 443]))).toEqual([]);
    const dead = networkFindings(state([]));
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({
      fingerprint: "unreachable",
      severity: "critical",
    });
  });

  it("flags an expiring certificate", () => {
    const s = state([80, 443]);
    s.tls = {
      port: 443,
      validTo: null,
      daysRemaining: 5,
      issuer: "Let's Encrypt",
      subject: "example.com",
      authorized: true,
      error: null,
    };
    expect(networkFindings(s)[0]).toMatchObject({
      fingerprint: "tls:expiry",
      severity: "high",
    });
  });
});

describe("resolveAddress", () => {
  it("refuses internal addresses and URLs", async () => {
    expect((await resolveAddress("127.0.0.1")).ok).toBe(false);
    expect((await resolveAddress("169.254.169.254")).ok).toBe(false);
    expect((await resolveAddress("10.0.0.5")).ok).toBe(false);
    expect((await resolveAddress("https://example.com/x")).ok).toBe(false);
    expect(await resolveAddress("203.0.113.10")).toEqual({
      ok: true,
      ips: ["203.0.113.10"],
    });
  });
});

describe("networkFindings over Tailscale", () => {
  it("reports open ports on a tailnet address as low, with tailnet wording", () => {
    const s = state([80, 443, 5432]);
    s.address = "100.81.123.101";
    s.resolved = ["100.81.123.101"];
    const [f] = networkFindings(s);
    expect(f).toMatchObject({ fingerprint: "open:5432", severity: "low" });
    expect(f!.title).toContain("tailnet");
  });
});
