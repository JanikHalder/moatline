import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("db", () => ({ db: {}, orgIntegrations: {}, servers: {} }));

import {
  fetchProject,
  portAccess,
  providerFindings,
  type ProviderFirewall,
} from "./hetzner";
import { securityFindings } from "./security-findings";

const fw = (
  inbound: ProviderFirewall["inbound"],
  status = "applied"
): ProviderFirewall => ({
  provider: "hetzner",
  checkedAt: "",
  serverName: "md-3",
  firewalls: [{ id: 1, name: "web", status }],
  inbound,
});

const rule = (port: string | null, sources: string[], protocol = "tcp") => ({
  protocol,
  port,
  sources,
  description: null,
  firewall: "web",
});

describe("portAccess", () => {
  it("reads single ports, ranges, sources and the default deny", () => {
    const f = fw([
      rule("443", ["0.0.0.0/0", "::/0"]),
      rule("27000-28000", ["198.51.100.7/32"]),
      rule("53", ["0.0.0.0/0"], "udp"),
    ]);
    expect(portAccess(f, 443)).toEqual({ access: "world", firewall: "web" });
    expect(portAccess(f, 27017)).toMatchObject({
      access: "restricted",
      sources: ["198.51.100.7/32"],
    });
    expect(portAccess(f, 53).access).toBe("closed");
    expect(portAccess(f, 5432).access).toBe("closed");
  });

  it("filters nothing while the firewall is not applied yet", () => {
    expect(portAccess(fw([], "pending"), 5432).access).toBe("unfiltered");
  });
});

describe("providerFindings", () => {
  const server = (report: unknown) => ({
    expectedPorts: [80, 443],
    lastReport: report,
  });

  it("warns when no firewall is applied, softer with UFW on", () => {
    const none = { ...fw([]), firewalls: [] };
    expect(providerFindings(none, server({}))[0]).toMatchObject({
      fingerprint: "hetzner:no-firewall",
      severity: "medium",
    });
    expect(
      providerFindings(none, server({ hardening: { ufw: "active" } }))[0]
    ).toMatchObject({ severity: "low" });
  });

  it("rates open rules by what listens behind them", () => {
    const f = fw([
      rule("22", ["0.0.0.0/0"]),
      rule("80", ["0.0.0.0/0"]),
      rule("6379", ["0.0.0.0/0"]),
      rule("9200", ["::/0"]),
      rule("5432", ["198.51.100.7/32"]),
    ]);
    const out = providerFindings(
      f,
      server({
        listeners: [
          { address: "0.0.0.0", port: 22, process: "sshd" },
          { address: "0.0.0.0", port: 6379, process: "redis-server" },
        ],
      })
    );
    expect(out.map((x) => [x.fingerprint, x.severity])).toEqual([
      ["hetzner:open:22", "low"],
      ["hetzner:open:6379", "critical"],
      ["hetzner:open:9200", "low"],
    ]);
    expect(out[2]!.title).toContain("nothing listens yet");
  });

  it("leaves Docker-published ports to the security findings", () => {
    const out = providerFindings(
      fw([rule("27017", ["0.0.0.0/0"])]),
      server({
        dockerRisks: { servicePorts: [{ hostPort: 27017 }] },
        listeners: [{ address: "::", port: 27017 }],
      })
    );
    expect(out).toEqual([]);
  });

  it("calls out a rule that opens everything", () => {
    const out = providerFindings(
      fw([rule("1-65535", ["0.0.0.0/0"])]),
      server({})
    );
    expect(out).toEqual([
      expect.objectContaining({
        fingerprint: "hetzner:all-ports",
        severity: "high",
      }),
    ]);
  });
});

describe("Docker-published ports with the Hetzner firewall", () => {
  const report = {
    dockerRisks: {
      containers: [],
      servicePorts: [
        { name: "mongo", hostPort: 27017, containerPort: "27017/tcp" },
      ],
    },
  };

  it("is critical when the firewall lets everyone in", () => {
    const [f] = securityFindings(report, {
      baseline: null,
      providerFirewall: fw([rule("27017", ["0.0.0.0/0"])]),
    });
    expect(f).toMatchObject({
      severity: "critical",
      title: "Port 27017 (MongoDB) is reachable from the internet",
    });
    expect(f!.detail).toContain('Hetzner firewall "web" allows it');
  });

  it("is medium when only listed IPs may connect", () => {
    const [f] = securityFindings(report, {
      baseline: null,
      providerFirewall: fw([rule("27017", ["198.51.100.7/32"])]),
    });
    expect(f).toMatchObject({ severity: "medium" });
    expect(f!.title).toContain("allows only some IPs");
    expect(f!.detail).toContain("198.51.100.7/32");
  });

  it("is medium when the firewall has no rule for it", () => {
    const [f] = securityFindings(report, {
      baseline: null,
      providerFirewall: fw([rule("443", ["0.0.0.0/0"])]),
    });
    expect(f).toMatchObject({ severity: "medium" });
    expect(f!.detail).toContain("has no rule for it");
  });
});

describe("fetchProject", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("attaches the applied firewalls' inbound rules to each server", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const body = url.includes("/servers")
        ? {
            servers: [
              {
                id: 7,
                name: "md-3",
                public_net: {
                  ipv4: { ip: "203.0.113.10" },
                  firewalls: [
                    { id: 1, status: "applied" },
                    { id: 2, status: "pending" },
                  ],
                },
              },
            ],
            meta: { pagination: { next_page: null } },
          }
        : {
            firewalls: [
              {
                id: 1,
                name: "web",
                rules: [
                  {
                    direction: "in",
                    protocol: "tcp",
                    port: "443",
                    source_ips: ["0.0.0.0/0"],
                  },
                  {
                    direction: "out",
                    protocol: "tcp",
                    port: "25",
                    destination_ips: ["0.0.0.0/0"],
                  },
                ],
              },
              { id: 2, name: "db", rules: [] },
            ],
            meta: { pagination: { next_page: null } },
          };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const [p] = await fetchProject("x".repeat(64));
    expect(p!.firewall.firewalls).toEqual([
      { id: 1, name: "web", status: "applied" },
      { id: 2, name: "db", status: "pending" },
    ]);
    expect(p!.firewall.inbound).toEqual([
      {
        protocol: "tcp",
        port: "443",
        sources: ["0.0.0.0/0"],
        description: null,
        firewall: "web",
      },
    ]);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      headers: { authorization: `Bearer ${"x".repeat(64)}` },
    });
  });

  it("names a rejected token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 }))
    );
    await expect(fetchProject("x".repeat(64))).rejects.toThrow(
      /rejected an API token/
    );
  });
});
