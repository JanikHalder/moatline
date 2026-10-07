import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  orgIntegrations: {},
  repositories: {},
  servers: {},
}));
vi.mock("../lib/server-findings", () => ({ syncAndNotify: vi.fn() }));

import { coolifyDatabaseFindings, matchCoolifyApp } from "./coolify";
import type { CoolifyResource } from "../lib/coolify";

const res = (p: Partial<CoolifyResource>): CoolifyResource => ({
  uuid: "u1",
  kind: "application",
  name: "X",
  status: null,
  githubRepo: null,
  branch: null,
  url: null,
  databaseType: null,
  environmentId: null,
  isPublic: false,
  publicPort: null,
  backups: [],
  ...p,
});

describe("matchCoolifyApp", () => {
  it("links by repository, preferring the branch", () => {
    const apps = [
      res({ uuid: "prod", githubRepo: "acme/site", branch: "main" }),
      res({ uuid: "stage", githubRepo: "acme/site", branch: "staging" }),
    ];
    expect(
      matchCoolifyApp(
        { githubUrl: "https://github.com/Acme/Site", defaultBranch: "main" },
        apps
      )?.uuid
    ).toBe("prod");
    expect(
      matchCoolifyApp(
        { githubUrl: "https://github.com/acme/site", defaultBranch: "dev" },
        apps
      )
    ).toBeNull();
  });
});

describe("coolifyDatabaseFindings", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("flags public databases and missing or failed backups", () => {
    expect(
      coolifyDatabaseFindings(
        res({
          kind: "database",
          uuid: "d1",
          name: "DB",
          databaseType: "standalone-postgresql",
          isPublic: true,
          publicPort: 5432,
        }),
        now
      ).map((f) => f.fingerprint)
    ).toEqual(["db-exposed|d1", "db-no-backup|d1"]);
    expect(
      coolifyDatabaseFindings(
        res({
          kind: "database",
          uuid: "d2",
          databaseType: "standalone-mongodb",
          backups: [
            {
              enabled: true,
              lastStatus: "failed",
              lastAt: "2026-10-05T03:00:00Z",
            },
          ],
        }),
        now
      ).map((f) => f.severity)
    ).toEqual(["high"]);
  });
  it("leaves caches alone", () => {
    expect(
      coolifyDatabaseFindings(
        res({ kind: "database", databaseType: "standalone-redis" }),
        now
      )
    ).toEqual([]);
  });
});
