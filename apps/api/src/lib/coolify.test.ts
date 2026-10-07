import { describe, expect, it } from "vitest";
import {
  coolifyDashboardUrl,
  deploymentState,
  githubRepoOf,
  parseApplications,
  parseDatabases,
  resourceOfContainer,
} from "./coolify";

describe("coolify parsing", () => {
  it("reads applications with their repository and first https domain", () => {
    const [a] = parseApplications([
      {
        uuid: "abc123def456ghi789jkl0mn",
        name: "shop",
        git_repository: "Acme/Shop",
        git_branch: "main",
        fqdn: "http://shop.local,https://shop.at",
        status: "running:healthy",
      },
    ]);
    expect(a).toMatchObject({
      kind: "application",
      githubRepo: "acme/shop",
      branch: "main",
      url: "https://shop.at",
    });
  });

  it("reads git URLs in every form", () => {
    expect(githubRepoOf("https://github.com/acme/site.git")).toBe("acme/site");
    expect(githubRepoOf("git@github.com:acme/site.git")).toBe("acme/site");
    expect(githubRepoOf("acme/site")).toBe("acme/site");
    expect(githubRepoOf("")).toBeNull();
  });

  it("reads databases with public port and backups", () => {
    const [d] = parseDatabases([
      {
        uuid: "db0000000000000000000001",
        name: "Shop DB",
        database_type: "standalone-postgresql",
        is_public: true,
        public_port: 5433,
        backup_configs: [
          {
            enabled: true,
            latest_log: {
              status: "failed",
              created_at: "2026-10-04T03:00:00Z",
            },
          },
        ],
      },
    ]);
    expect(d).toMatchObject({
      isPublic: true,
      publicPort: 5433,
      backups: [
        { enabled: true, lastStatus: "failed", lastAt: "2026-10-04T03:00:00Z" },
      ],
    });
  });

  it("maps deployment statuses", () => {
    expect(deploymentState("queued")).toBe("running");
    expect(deploymentState("in_progress")).toBe("running");
    expect(deploymentState("finished")).toBe("done");
    expect(deploymentState("failed")).toBe("error");
    expect(deploymentState("cancelled-by-user")).toBe("error");
  });

  it("finds a container's resource by the uuid in its name", () => {
    const res = [
      { uuid: "ow8ook8skccoocckkcscoock" },
      { uuid: "zz9zz9zz9zz9zz9zz9zz9zz9" },
    ];
    expect(
      resourceOfContainer({ name: "mail-ow8ook8skccoocckkcscoock" }, res)?.uuid
    ).toBe("ow8ook8skccoocckkcscoock");
    expect(
      resourceOfContainer({ name: "zz9zz9zz9zz9zz9zz9zz9zz9-123456789" }, res)
        ?.uuid
    ).toBe("zz9zz9zz9zz9zz9zz9zz9zz9");
    expect(resourceOfContainer({ name: "traefik" }, res)).toBeNull();
  });
});

describe("coolifyDashboardUrl", () => {
  it("links into Coolify once the environment is known", () => {
    expect(
      coolifyDashboardUrl(
        "https://coolify.example.com/api/v1",
        { kind: "application", uuid: "u1" },
        { project: "p1", environment: "e1" }
      )
    ).toBe(
      "https://coolify.example.com/project/p1/environment/e1/application/u1"
    );
    expect(
      coolifyDashboardUrl(
        "https://coolify.example.com",
        { kind: "application", uuid: "u1" },
        undefined
      )
    ).toBeNull();
  });
});
