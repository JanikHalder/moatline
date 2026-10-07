import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({ db: {}, orgIntegrations: {}, servers: {} }));
vi.mock("../lib/server-findings", () => ({ syncAndNotify: vi.fn() }));
vi.mock("./deploy", () => ({ resolveDokployConfig: vi.fn() }));
vi.mock("./container-redeploy", () => ({ servicesOf: vi.fn() }));
vi.mock("./coolify", () => ({ coolifyResources: vi.fn() }));

import {
  databaseFindings,
  dokployNodeOf,
  missingServers,
  placeServices,
} from "./dokploy-risk";
import { parseDatabaseDetails, type DokployService } from "../lib/dokploy";

const svc = (p: Partial<DokployService>): DokployService => ({
  applicationId: "x",
  kind: "application",
  name: "X",
  appName: "x-1",
  project: "Kunde",
  environment: "production",
  githubRepo: null,
  branch: null,
  autoDeploy: false,
  serverId: null,
  ...p,
});

const report = (apps: string[]) => ({
  containers: apps.map((app) => ({ app, name: `${app}.1.abc` })),
});

describe("placeServices", () => {
  const services = [
    svc({ applicationId: "web", appName: "web-1", serverId: "remote" }),
    svc({
      applicationId: "db",
      appName: "mongo-1",
      kind: "mongo",
      serverId: "remote",
    }),
    svc({ applicationId: "host-app", appName: "cms-1" }),
  ];
  const rows = [
    { id: "s1", lastReport: report(["web-1"]) },
    { id: "s2", lastReport: report(["cms-1"]) },
  ];

  it("places by reported containers, and the rest by their Dokploy server", () => {
    const placed = placeServices(services, rows);
    expect(placed.get("web")).toBe("s1");
    // Not running right now, but on the same Dokploy server as "web".
    expect(placed.get("db")).toBe("s1");
    expect(placed.get("host-app")).toBe("s2");
  });

  it("knows Dokploy's id for each server", () => {
    expect(dokployNodeOf("s1", services, rows)).toBe("remote");
    expect(dokployNodeOf("s2", services, rows)).toBeNull();
    expect(dokployNodeOf("s3", services, rows)).toBeUndefined();
  });
});

describe("databaseFindings", () => {
  const mongo = svc({
    applicationId: "m1",
    kind: "mongo",
    name: "Mongo",
    appName: "mongo-1",
  });
  const now = Date.parse("2026-10-04T12:00:00Z");

  it("flags a published port and a missing backup", () => {
    const f = databaseFindings(
      mongo,
      { externalPort: 27017, backups: [] },
      now
    );
    expect(f.map((x) => [x.fingerprint, x.severity])).toEqual([
      ["db-exposed|m1", "high"],
      ["db-no-backup|m1", "medium"],
    ]);
  });

  it("flags failed, disabled and late backups", () => {
    const base = { schedule: "0 3 * * *", database: "app", destination: "S3" };
    const f = databaseFindings(
      mongo,
      {
        externalPort: null,
        backups: [
          {
            ...base,
            backupId: "b1",
            enabled: true,
            lastRun: { status: "error", at: "2026-10-04T03:00:00Z" },
          },
          { ...base, backupId: "b2", enabled: false, lastRun: null },
          {
            ...base,
            backupId: "b3",
            enabled: true,
            lastRun: { status: "done", at: "2026-09-30T03:00:00Z" },
          },
          {
            ...base,
            backupId: "b4",
            enabled: true,
            lastRun: { status: "done", at: "2026-10-04T03:00:00Z" },
          },
        ],
      },
      now
    );
    expect(f.map((x) => x.fingerprint)).toEqual([
      "db-backup-failed|b1",
      "db-backup-off|b2",
      "db-backup-late|b3",
    ]);
  });

  it("does not ask Redis for backups Dokploy cannot make", () => {
    const redis = svc({ applicationId: "r1", kind: "redis", name: "Cache" });
    expect(
      databaseFindings(redis, { externalPort: null, backups: [] }, now)
    ).toEqual([]);
  });
});

describe("parseDatabaseDetails", () => {
  it("keeps port and backups, nothing else", () => {
    const d = parseDatabaseDetails({
      externalPort: 5432,
      databasePassword: "secret",
      backups: [
        {
          backupId: "b1",
          enabled: true,
          schedule: "0 3 * * *",
          database: "app",
          destination: { name: "Hetzner S3", secretAccessKey: "x" },
          deployments: [
            { status: "done", createdAt: "2026-10-02T03:00:00Z" },
            { status: "error", createdAt: "2026-10-03T03:00:00Z" },
          ],
        },
      ],
    });
    expect(d).toEqual({
      externalPort: 5432,
      backups: [
        {
          backupId: "b1",
          enabled: true,
          schedule: "0 3 * * *",
          database: "app",
          destination: "Hetzner S3",
          lastRun: { status: "error", at: "2026-10-03T03:00:00Z" },
        },
      ],
    });
    expect(JSON.stringify(d)).not.toContain("secret");
  });

  it("reads no port as null", () => {
    expect(
      parseDatabaseDetails({ externalPort: null }).externalPort
    ).toBeNull();
  });
});

describe("missingServers", () => {
  const services = [
    svc({ applicationId: "a", appName: "web-1", serverId: "r1" }),
    svc({ applicationId: "b", appName: "cms-1" }),
  ];

  it("finds Dokploy servers no agent reports, by services or address", () => {
    const rows = [
      { id: "s1", lastReport: report(["web-1"]), address: null },
      { id: "s2", lastReport: null, address: "10.0.0.3" },
    ];
    expect(
      missingServers(
        [
          { serverId: "r1", name: "web", ipAddress: "10.0.0.1" },
          { serverId: "r2", name: "db", ipAddress: "10.0.0.2" },
          { serverId: "r3", name: "new", ipAddress: "10.0.0.3" },
        ],
        services,
        rows,
        "dokploy.example.com"
      )
    ).toEqual([
      {
        dokployServerId: null,
        name: "Dokploy host",
        address: "dokploy.example.com",
      },
      { dokployServerId: "r2", name: "db", address: "10.0.0.2" },
    ]);
  });
});
