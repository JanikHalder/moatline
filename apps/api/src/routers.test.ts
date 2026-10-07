import { describe, it, expect, vi, afterEach } from "vitest";

const emptyPromise = Promise.resolve([]);

const getSessionMock = vi.fn().mockResolvedValue(null);
vi.mock("./auth", () => ({
  auth: {
    api: { getSession: getSessionMock },
    handler: vi.fn((_req: Request) => new Response()),
  },
}));

vi.mock("db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Object.assign(emptyPromise, { limit: () => emptyPromise }),
        orderBy: () => ({ limit: () => emptyPromise }),
      }),
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: "x" }]) }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
  repositories: {},
  scans: {},
  packageFindings: {},
  vulnerabilities: {},
  updateRuns: {},
  deployRuns: {},
  orgIntegrations: {},
  organization: {},
  member: {},
  user: {},
  servers: {},
  serverFindings: {},
  serverMetrics: {},
  serverScanRuns: {},
  auditLog: {},
  apiKeys: {},
}));

const withSession = () =>
  getSessionMock.mockResolvedValueOnce({
    user: { id: "u1", email: "u@t.com", name: "U" },
    session: { id: "s1", userId: "u1", activeOrganizationId: "org1" },
  } as never);

afterEach(() => getSessionMock.mockResolvedValue(null));

describe("dashboard router", () => {
  it("requires an organization (403 without session)", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/dashboard");
    expect(res.status).toBe(403);
  });

  it("returns empty totals + repos with a session", async () => {
    withSession();
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/dashboard");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.repos).toEqual([]);
    expect(data.totals).toMatchObject({ critical: 0, total: 0 });
  });
});

describe("org integrations router", () => {
  it("rejects the demo/no-session path with 401", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/org/integrations");
    expect(res.status).toBe(401);
  });

  it("returns masked settings (no raw secrets) with a session", async () => {
    withSession();
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/org/integrations");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.dokployTokenSet).toBe(false);
    expect(data.telegramBotTokenSet).toBe(false);
    expect(data).not.toHaveProperty("dokployToken");
  });
});

describe("scans vulnerabilities route", () => {
  it("404s when the scan is not found", async () => {
    withSession();
    const { app } = await import("./app");
    const res = await app.request(
      "http://localhost/api/scans/nope/vulnerabilities"
    );
    expect(res.status).toBe(404);
  });
});

describe("system router", () => {
  it("requires an organization (403 without session)", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/system/scheduler");
    expect(res.status).toBe(403);
  });

  it("reports the scheduler as disabled when it was never started", async () => {
    withSession();
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/system/scheduler");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      enabled: false,
      checkInterval: "*/5 * * * *",
    });
  });
});

describe("members router", () => {
  const body = JSON.stringify({ email: "new@t.com", role: "member" });
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  };

  it("rejects the demo/no-session path with 401", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/org/members", init);
    expect(res.status).toBe(401);
  });

  it("rejects a caller who is not an owner or admin with 403", async () => {
    withSession();
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/org/members", init);
    expect(res.status).toBe(403);
  });
});

describe("live-check routes", () => {
  it("requires an organization (403 without session)", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/repos/r1/live-check", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("404s for a repo the organization does not own", async () => {
    withSession();
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/repos/r1/live-check", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("keeps the live scan behind the tenant check too", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/repos/r1/scan-live", {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("404s the live scan for a repo the organization does not own", async () => {
    withSession();
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/repos/r1/scan-live", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("keeps the Dokploy domain suggestions behind the same tenant check", async () => {
    const { app } = await import("./app");
    const res = await app.request(
      "http://localhost/api/repos/r1/dokploy-domains"
    );
    expect(res.status).toBe(403);
  });
});

describe("mcp endpoint", () => {
  it("never accepts a browser session, only an API key", async () => {
    withSession();
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects unknown keys", async () => {
    const { app } = await import("./app");
    const res = await app.request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer pck_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });
});
