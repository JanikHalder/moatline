import { describe, it, expect, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  orgIntegrations: {},
  repositories: {},
  servers: {},
  serverFindings: {},
}));

import { assignMonitor, kumaFindings, parseKumaMetrics } from "./kuma";

const METRICS = `# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)
# TYPE monitor_status gauge
monitor_status{monitor_name="Shop",monitor_type="http",monitor_url="https://shop.example.com/health",monitor_hostname="null",monitor_port="null"} 0
monitor_status{monitor_name="Blog \\"main\\"",monitor_type="http",monitor_url="https://blog.example.com",monitor_hostname="null",monitor_port="null"} 1
monitor_response_time{monitor_name="Blog \\"main\\"",monitor_type="http",monitor_url="https://blog.example.com",monitor_hostname="null",monitor_port="null"} 120
monitor_cert_days_remaining{monitor_name="Blog \\"main\\"",monitor_type="http",monitor_url="https://blog.example.com",monitor_hostname="null",monitor_port="null"} 5
monitor_cert_is_valid{monitor_name="Blog \\"main\\"",monitor_type="http",monitor_url="https://blog.example.com",monitor_hostname="null",monitor_port="null"} 1
`;

describe("parseKumaMetrics", () => {
  it("reads status, response time and certificate data per monitor", () => {
    const m = parseKumaMetrics(METRICS);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ name: "Shop", status: 0, hostname: null });
    expect(m[1]).toMatchObject({
      name: 'Blog "main"',
      status: 1,
      responseTimeMs: 120,
      certDaysRemaining: 5,
      certValid: true,
    });
  });
});

describe("kumaFindings", () => {
  it("raises down monitors and expiring certificates, linked to the app", () => {
    const f = kumaFindings(
      parseKumaMetrics(METRICS),
      new Map([["shop.example.com", "repo-shop"]])
    );
    expect(f.map((x) => [x.fingerprint, x.severity, x.repositoryId])).toEqual([
      ["down:Shop", "critical", "repo-shop"],
      ['cert-expiry:Blog "main"', "high", null],
    ]);
  });
});

describe("assignMonitor", () => {
  const [shop, blog] = parseKumaMetrics(METRICS);
  const server = (id: string, kumaMonitors: string[] = []) =>
    ({ id, name: id, kumaMonitors }) as never;
  const repo = (id: string, liveUrl: string, serverId: string | null) => ({
    id,
    name: id,
    liveUrl,
    serverId,
  });

  it("follows the application's live URL to its server", () => {
    const a = assignMonitor(shop!, {
      servers: [server("web-01")],
      repos: [repo("shop", "https://shop.example.com/api/health", "web-01")],
    });
    expect(a).toMatchObject({
      serverId: "web-01",
      repositoryId: "shop",
      via: "url",
    });
  });

  it("lets a monitor picked on a server win over the URL match", () => {
    const a = assignMonitor(shop!, {
      servers: [server("web-01"), server("web-02", ["Shop"])],
      repos: [repo("shop", "https://shop.example.com", "web-01")],
    });
    expect(a).toMatchObject({ serverId: "web-02", via: "manual" });
  });

  it("leaves unknown monitors unassigned", () => {
    expect(
      assignMonitor(blog!, { servers: [server("web-01")], repos: [] })
    ).toMatchObject({ serverId: null, repositoryId: null, via: null });
  });
});
