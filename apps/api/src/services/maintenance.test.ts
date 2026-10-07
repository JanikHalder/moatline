import { describe, expect, it, vi } from "vitest";

vi.mock("db", () => ({
  db: {},
  maintenanceWindows: {},
  repositories: {},
  servers: {},
  serverFindings: {},
  orgIntegrations: {},
  member: {},
}));

import { covers } from "./maintenance";
import { combine } from "./down-batch";

describe("maintenance", () => {
  it("covers what its scope names, and a repository through its server", () => {
    const org = { scope: "organization" as const, targetId: null };
    const srv = { scope: "server" as const, targetId: "s1" };
    const repo = { scope: "repository" as const, targetId: "r1" };
    expect(covers(org, { repositoryId: "rX" })).toBe(true);
    expect(covers(srv, { serverId: "s1", repositoryId: "r9" })).toBe(true);
    expect(covers(srv, { serverId: "s2" })).toBe(false);
    expect(covers(repo, { repositoryId: "r1" })).toBe(true);
    expect(covers(repo, { repositoryId: "r2", serverId: "s1" })).toBe(false);
  });
});

describe("grouped outages", () => {
  const ev = (n: string) => ({
    type: "server_alert" as const,
    title: `${n} is down`,
    message: "…",
    scope: { serverId: "s1" },
  });

  it("sends one site's message unchanged", () => {
    expect(
      combine("web-1", [{ name: "shop", event: ev("shop") }], false)
    ).toEqual(ev("shop"));
  });

  it("makes one message for several sites, naming the server", () => {
    const m = combine(
      "web-1",
      [
        { name: "shop", event: ev("shop") },
        { name: "blog", event: ev("blog") },
      ],
      true
    );
    expect(m.title).toBe("2 sites on web-1 are down");
    expect(m.message).toContain("agent stopped reporting too");
    expect(m.message).toContain("• blog");
  });
});
