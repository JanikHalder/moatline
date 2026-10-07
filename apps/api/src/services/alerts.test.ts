import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  incidents: {},
  orgIntegrations: {},
  repositories: {},
}));
vi.mock("../lib/notify", () => ({ notify: vi.fn() }));
vi.mock("./incidents", () => ({ MAX_HEALS_PER_DAY: 3 }));
vi.mock("./platforms", () => ({
  hasDeployTarget: vi.fn(),
  platform: vi.fn(),
  repoTarget: vi.fn(),
}));

import { newAlertToken, parseAlerts, repoForAlert } from "./alerts";

describe("parseAlerts", () => {
  it("reads the Alertmanager / Grafana webhook", () => {
    const alerts = parseAlerts({
      status: "firing",
      commonLabels: { severity: "critical" },
      alerts: [
        {
          status: "firing",
          labels: { alertname: "HighErrorRate", service: "shop" },
          annotations: {
            summary: "5xx above 5%",
            description: "for 10 minutes",
          },
          fingerprint: "abc123",
          generatorURL: "https://grafana.example.com/alerting/1",
        },
        {
          status: "resolved",
          labels: { alertname: "DiskFull", job: "cms" },
          fingerprint: "def456",
        },
      ],
    });
    expect(alerts).toEqual([
      {
        id: "abc123",
        status: "firing",
        title: "5xx above 5%",
        description: "for 10 minutes",
        labels: {
          severity: "critical",
          alertname: "HighErrorRate",
          service: "shop",
        },
        url: "https://grafana.example.com/alerting/1",
      },
      expect.objectContaining({
        id: "def456",
        status: "resolved",
        title: "DiskFull",
      }),
    ]);
  });

  it("reads a plain alert object, with a stable id", () => {
    const [a] = parseAlerts({
      title: "Checkout slow",
      status: "firing",
      service: "shop",
    });
    const [b] = parseAlerts({
      title: "Checkout slow",
      status: "firing",
      service: "shop",
    });
    expect(a).toMatchObject({
      title: "Checkout slow",
      labels: { service: "shop" },
    });
    expect(a!.id).toBe(b!.id);
  });

  it("ignores payloads without a title", () => {
    expect(parseAlerts({ status: "firing" })).toEqual([]);
  });
});

describe("repoForAlert", () => {
  const repos = [
    {
      id: "1",
      name: "shop",
      githubUrl: "https://github.com/acme/shop-site",
      dokployAppName: "shop-x1",
    },
    {
      id: "2",
      name: "cms",
      githubUrl: "https://github.com/acme/cms",
      dokployAppName: null,
    },
  ];
  it("matches by name, platform service or GitHub repository", () => {
    expect(repoForAlert({ service: "Shop" }, repos)?.id).toBe("1");
    expect(repoForAlert({ job: "shop-x1" }, repos)?.id).toBe("1");
    expect(repoForAlert({ app: "acme/cms" }, repos)?.id).toBe("2");
    expect(repoForAlert({ service_name: "shop-site" }, repos)?.id).toBe("1");
    expect(repoForAlert({ service: "billing" }, repos)).toBeNull();
  });
});

describe("newAlertToken", () => {
  it("makes a token with a prefix and its hash", () => {
    const { token, hash } = newAlertToken();
    expect(token).toMatch(/^pcal_[A-Za-z0-9_-]{30,}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
